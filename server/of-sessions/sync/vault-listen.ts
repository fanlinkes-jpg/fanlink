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

/** Pide todas las carpetas y, en cada una, todos los medios. No se queda en la primera página. */
export async function readVaultFromPage(page: Page): Promise<unknown[]> {
  await page.goto("https://onlyfans.com/my/chats", { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => undefined);
  const pulled = await page.evaluate(async () => {
    async function pull(path: string): Promise<unknown | null> {
      try {
        const response = await fetch(path, { credentials: "include", headers: { accept: "application/json" } });
        if (!response.ok) return null;
        return await response.json();
      } catch {
        return null;
      }
    }
    function rows(payload: unknown): Array<Record<string, unknown>> {
      if (!payload || typeof payload !== "object") return [];
      const list = (payload as { list?: unknown }).list;
      if (!Array.isArray(list)) return [];
      return list.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object");
    }
    const out: unknown[] = [];
    const folderIds: string[] = [];
    for (let offset = 0; offset < 1000; offset += 10) {
      const payload = await pull(`/api2/v2/vault/lists?view=main&offset=${offset}&limit=10`);
      if (!payload) break;
      out.push(payload);
      const list = rows(payload);
      for (const entry of list) {
        const id = entry.id == null ? "" : String(entry.id);
        if (id && !folderIds.includes(id)) folderIds.push(id);
      }
      const hasMore = (payload as { hasMore?: boolean }).hasMore === true;
      if (!hasMore || list.length < 10) break;
    }
    async function pullMedia(listId: string): Promise<void> {
      for (let offset = 0; offset < 4000; offset += 40) {
        const payload = await pull(`/api2/v2/vault/media?limit=40&offset=${offset}&field=recent&sort=desc&list=${encodeURIComponent(listId)}`);
        if (!payload) break;
        out.push(payload);
        const media = rows(payload);
        const hasMore = (payload as { hasMore?: boolean }).hasMore === true;
        if (!hasMore || media.length < 40) break;
      }
    }
    await pullMedia("all");
    for (const id of folderIds) await pullMedia(id);
    return out;
  }).catch(() => [] as unknown[]);
  const parsed = pulled.map((payload) => parseVaultBundle(payload));
  const folders = new Set(parsed.flatMap((bundle) => bundle.lists.map((list) => list.id)));
  const files = new Set(parsed.flatMap((bundle) => bundle.items.map((item) => item.id)));
  console.info(`[fanlink:vault] carpetas=${folders.size} medios=${files.size}`);
  if (folders.size > 0 || files.size > 0) return pulled;
  return captureVaultAt(page, "https://onlyfans.com/my/vault");
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
