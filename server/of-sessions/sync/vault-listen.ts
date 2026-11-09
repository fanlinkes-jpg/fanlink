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
    await clickVaultButton(page);
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

async function clickVaultButton(page: Page): Promise<void> {
  const selectors = [
    "[at-attr='attach_vault']",
    "[at-attr='add_vault_media']",
    "[at-attr='vault_btn']",
    "[data-fanlink-vault]",
    "button[aria-label*='vault' i]",
    "button[aria-label*='bóveda' i]",
    "button[aria-label*='boveda' i]",
    "button[aria-label*='media vault' i]",
  ];
  for (const selector of selectors) {
    const button = page.locator(selector).first();
    if (await button.count()) {
      await button.click({ timeout: 2_000 }).catch(() => undefined);
      return;
    }
  }
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
