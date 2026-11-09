import type { Page } from "playwright";
import { parseVaultBundle } from "./vault-model.ts";

export type VaultFile = {
  id: string;
  title: string;
  kind: "foto" | "video" | "audio" | null;
};

/** Lee el JSON que la propia página pide al abrir el vault. No llama a api2. */
export function parseVaultPayload(payload: unknown): VaultFile[] {
  const list = vaultList(payload);
  const out: VaultFile[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const id = textOf(row.id ?? row.mediaId);
    if (!id) continue;
    const title = (textOf(row.title ?? row.name ?? row.fileName) ?? id).slice(0, 80);
    const type = (textOf(row.type ?? row.kind) ?? "").toLowerCase();
    const kind = type.includes("video")
      ? "video" as const
      : type.includes("audio")
        ? "audio" as const
        : type.includes("photo") || type.includes("image") || type.includes("foto")
          ? "foto" as const
          : null;
    out.push({ id, title, kind });
  }
  return out;
}

const VAULT_LIST_CAP = 100;
const VAULT_MEDIA_CAP = 40;
const VAULT_OFFSET_CAP = 2_000;

/** El fetch suelto no firma la petición: OnlyFans la rechaza y el panel queda vacío. */
export function chooseVaultPayloads(direct: readonly unknown[], fromPage: readonly unknown[]): unknown[] {
  if (countVault(direct).files > 0) return trimVaultPayloads(direct);
  if (countVault(fromPage).files > 0 || countVault(fromPage).folders > 0) return trimVaultPayloads(fromPage);
  if (countVault(direct).folders > 0) return trimVaultPayloads(direct);
  return [];
}

export function countVault(payloads: readonly unknown[]): { files: number; folders: number } {
  const files = new Set<string>();
  const folders = new Set<string>();
  for (const payload of payloads) {
    const bundle = parseVaultBundle(payload);
    for (const list of bundle.lists) folders.add(list.id);
    for (const item of bundle.items) files.add(item.id);
  }
  return { files: files.size, folders: folders.size };
}

function trimVaultPayloads(payloads: readonly unknown[]): unknown[] {
  const out: unknown[] = [];
  let folders = 0;
  let files = 0;
  for (const payload of payloads) {
    const bundle = parseVaultBundle(payload);
    if (bundle.lists.length === 0 && bundle.items.length === 0) continue;
    out.push(payload);
    folders += bundle.lists.length;
    files += bundle.items.length;
    if (files >= VAULT_MEDIA_CAP && folders > 0) break;
    if (files >= VAULT_MEDIA_CAP && folders >= VAULT_LIST_CAP) break;
  }
  return out;
}

/** Una página por clic. Si el fetch no trae medios, se queda con lo que pide la página /my/vault. No pulsa el compositor. */
export async function readVaultFromPage(page: Page, listId = "all", offset = 0): Promise<unknown[]> {
  const cleanOffset = Number.isFinite(offset) && offset > 0 ? Math.min(VAULT_OFFSET_CAP, Math.floor(offset)) : 0;
  const cleanList = listId.trim().slice(0, 80) || "all";
  const direct = await pullVaultApi(page, cleanList, cleanOffset);
  const fromPage = countVault(direct).files > 0 ? [] : await readOpenedVault(page, cleanList, cleanOffset);
  const chosen = chooseVaultPayloads(direct, fromPage);
  const counts = countVault(chosen);
  console.info(`[fanlink:vault] pagina lista=${cleanList} offset=${cleanOffset} carpetas=${counts.folders} medios=${counts.files}`);
  return chosen;
}

async function pullVaultApi(page: Page, listId: string, offset: number): Promise<unknown[]> {
  if (!page.url().includes("onlyfans.com/")) return [];
  return page.evaluate(async ({ listId, offset, listCap, mediaCap }) => {
    async function pull(path: string): Promise<unknown | null> {
      try {
        const response = await fetch(path, { credentials: "include", headers: { accept: "application/json" } });
        if (!response.ok) return null;
        return await response.json();
      } catch {
        return null;
      }
    }
    const out: unknown[] = [];
    if (offset === 0) {
      const lists = await pull(`/api2/v2/vault/lists?view=main&offset=0&limit=${listCap}`);
      if (lists) out.push(lists);
    }
    const media = await pull(`/api2/v2/vault/media?limit=${mediaCap}&offset=${offset}&field=recent&sort=desc&list=${encodeURIComponent(listId)}`);
    if (media) out.push(media);
    return out;
  }, { listId, offset, listCap: VAULT_LIST_CAP, mediaCap: VAULT_MEDIA_CAP }).catch(() => [] as unknown[]);
}

/** Abre la bóveda de OnlyFans y copia el JSON que ella misma pide. Sin clics al compositor. */
async function readOpenedVault(page: Page, listId: string, offset: number): Promise<unknown[]> {
  const found: unknown[] = [];
  const pending: Array<Promise<void>> = [];
  const onResponse = (response: { url(): string; status(): number; text(): Promise<string> }) => {
    if (response.status() < 200 || response.status() >= 300) return;
    if (!/\/api2\/v2\/vault\/(?:lists|media)(?:\?|$)/.test(response.url())) return;
    pending.push(response.text().then((raw) => {
      try {
        found.push(JSON.parse(raw) as unknown);
      } catch {
        // No es el listado.
      }
    }).catch(() => undefined));
  };
  page.on("response", onResponse);
  try {
    await page.goto("https://onlyfans.com/my/vault", { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => undefined);
    await waitForVault(found, pending, 12_000, () => countVault(found).files > 0);
    if (listId !== "all") await openFolder(page, found, pending, listId);
    if (offset > 0) await scrollForMore(page, found, pending, offset);
    await Promise.all(pending);
    return found;
  } finally {
    page.off("response", onResponse);
  }
}

async function openFolder(page: Page, found: unknown[], pending: Array<Promise<void>>, listId: string): Promise<void> {
  const name = found.flatMap((payload) => parseVaultBundle(payload).lists).find((list) => list.id === listId)?.name;
  if (!name) return;
  const before = countVault(found).files;
  const clicked = await page.getByRole("button", { name, exact: true }).click({ timeout: 2_000 }).then(() => true).catch(async () => {
    return page.getByText(name, { exact: true }).first().click({ timeout: 2_000 }).then(() => true).catch(() => false);
  });
  if (!clicked) return;
  await waitForVault(found, pending, 6_000, () => countVault(found).files > before);
}

async function scrollForMore(page: Page, found: unknown[], pending: Array<Promise<void>>, offset: number): Promise<void> {
  const target = Math.min(VAULT_OFFSET_CAP, offset + 1);
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline && countVault(found).files < target && countVault(found).files < VAULT_MEDIA_CAP) {
    await page.mouse.wheel(0, 1_400).catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  await Promise.all(pending);
}

async function waitForVault(found: unknown[], pending: Array<Promise<void>>, waitMs: number, done: () => boolean): Promise<void> {
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline && !done()) {
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  await Promise.all(pending);
}

/** Abre la página y espera el JSON de los medios. No vuelve antes de leer el cuerpo. */
export async function captureVaultAt(page: Page, vaultUrl: string, waitMs = 15_000): Promise<unknown[]> {
  const found: unknown[] = [];
  const pending: Array<Promise<void>> = [];
  const onResponse = (response: { url(): string; status(): number; text(): Promise<string> }) => {
    if (response.status() < 200 || response.status() >= 300) return;
    if (!/vault/i.test(response.url())) return;
    pending.push(response.text().then((raw) => {
      try {
        found.push(JSON.parse(raw) as unknown);
      } catch {
        // La página puede pedir un HTML, no un listado.
      }
    }).catch(() => undefined));
  };
  page.on("response", onResponse);
  try {
    await page.goto(vaultUrl, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => undefined);
    const clicked = await clickVaultButton(page) || await clickComposerMedia(page, () => found.some((payload) => parseVaultBundle(payload).items.length > 0));
    console.info(`[fanlink:vault] url=${page.url()} boton=${clicked ? "si" : "no"}`);
    const deadline = Date.now() + waitMs;
    while (Date.now() < deadline) {
      if (found.some((payload) => parseVaultBundle(payload).items.length > 0)) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    await Promise.all(pending);
    return found;
  } finally {
    page.off("response", onResponse);
  }
}

async function clickVaultButton(page: Page): Promise<boolean> {
  const selector = [
    "[at-attr='attach_vault']",
    "[at-attr='add_vault_media']",
    "[at-attr='vault_btn']",
    "[data-fanlink-vault]",
    "button[aria-label*='vault' i]",
    "button[aria-label*='bóveda' i]",
    "button[aria-label*='boveda' i]",
    "button[aria-label*='media vault' i]",
  ].join(", ");
  const button = page.locator(selector).first();
  const visible = await button.waitFor({ state: "visible", timeout: 8_000 }).then(() => true).catch(() => false);
  if (!visible) {
    const attrs = await page.locator("[at-attr]").evaluateAll((nodes) => nodes.slice(0, 20).map((node) => node.getAttribute("at-attr") ?? "")).catch(() => []);
    console.info(`[fanlink:vault] sin boton attrs=${attrs.join(",")}`);
    return false;
  }
  await button.click({ timeout: 2_000 }).catch(() => undefined);
  return true;
}

async function clickComposerMedia(page: Page, hasMedia: () => boolean): Promise<boolean> {
  const buttons = page.locator("form button, .b-chat__footer button, .b-make-post button");
  const count = await buttons.count().catch(() => 0);
  for (let index = 0; index < Math.min(count, 8); index += 1) {
    const button = buttons.nth(index);
    const name = await button.innerText().catch(() => "");
    if (/send|enviar/i.test(name)) continue;
    await button.click({ timeout: 1_000 }).catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 700));
    if (hasMedia()) return true;
  }
  return false;
}

export async function captureVaultPayloads(page: Page, waitMs = 2_500): Promise<unknown[]> {
  const found: unknown[] = [];
  await listenVault(page, waitMs, (payload) => {
    found.push(payload);
  });
  return found;
}

export async function captureVaultList(page: Page, waitMs = 2_500): Promise<VaultFile[]> {
  const found: VaultFile[] = [];
  await listenVault(page, waitMs, (payload) => {
    found.push(...parseVaultPayload(payload));
  }, () => found.length > 0);
  const seen = new Set<string>();
  return found.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

async function listenVault(
  page: Page,
  waitMs: number,
  onPayload: (payload: unknown) => void,
  done?: () => boolean,
): Promise<void> {
  const onResponse = (response: { url(): string; status(): number; text(): Promise<string> }) => {
    if (response.status() < 200 || response.status() >= 300) return;
    if (!/vault/i.test(response.url())) return;
    void response.text().then((raw) => {
      try {
        onPayload(JSON.parse(raw) as unknown);
      } catch {
        // La página puede pedir un HTML, no un listado.
      }
    }).catch(() => undefined);
  };
  page.on("response", onResponse);
  try {
    const button = page.locator("[at-attr='vault_btn'], [data-fanlink-vault], button[aria-label='Add from media vault' i]").first();
    if (await button.count()) await button.click();
    const deadline = Date.now() + waitMs;
    while (Date.now() < deadline && !done?.()) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  } finally {
    page.off("response", onResponse);
  }
}

function vaultList(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  const row = payload as Record<string, unknown>;
  for (const key of ["list", "items", "media", "files"]) {
    if (Array.isArray(row[key])) return row[key] as unknown[];
  }
  return [];
}

function textOf(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}
