import type { Page } from "playwright";

export type OnlineFan = {
  fanKey: string;
  fanName: string | null;
  fanHandle: string | null;
  avatarUrl: string | null;
};

const FANS_URL = "https://onlyfans.com/my/collections/user-lists/subscribers/active";

/** El filtro «En línea» de Fans. Si la petición ya viene filtrada, todos cuentan. */
export function onlineFansFromPayload(payload: unknown, onlyMarked = true): OnlineFan[] {
  const rows = listOf(payload);
  const out: OnlineFan[] = [];
  const seen = new Set<string>();
  for (const item of rows) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    if (onlyMarked && onlineFlag(row.isOnline ?? row.online) !== true) continue;
    const fanKey = text(row.id);
    if (!fanKey || seen.has(fanKey)) continue;
    seen.add(fanKey);
    out.push({
      fanKey,
      fanName: text(row.name ?? row.displayName),
      fanHandle: text(row.username ?? row.handle),
      avatarUrl: text(row.avatar),
    });
  }
  return out.slice(0, 100);
}

export function subscribersResponse(url: string): "online" | "all" | null {
  if (!url.includes("/subscriptions/subscribers") && !url.includes("/lists/")) return null;
  if (/filter(?:\[|%5B)online(?:\]|%5D)=1|(?:^|[?&])online=1/i.test(url)) return "online";
  if (url.includes("/subscriptions/subscribers") || /\/lists\/[^/]+\/users/.test(url)) return "all";
  return null;
}

/** Abre Fans y se queda con quien OnlyFans marca en línea. No firma la API. */
export async function readOnlineSubscribers(page: Page, signal?: AbortSignal): Promise<OnlineFan[]> {
  if (signal?.aborted) return [];
  const marked: OnlineFan[] = [];
  const filtered: OnlineFan[] = [];
  const pending: Array<Promise<void>> = [];
  const onResponse = (response: { url(): string; status(): number; text(): Promise<string> }) => {
    const kind = subscribersResponse(response.url());
    if (!kind || response.status() < 200 || response.status() >= 300) return;
    pending.push(response.text().then((raw) => {
      let payload: unknown;
      try {
        payload = JSON.parse(raw);
      } catch {
        return;
      }
      const rows = onlineFansFromPayload(payload, kind !== "online");
      (kind === "online" ? filtered : marked).push(...rows);
    }).catch(() => undefined));
  };
  page.on("response", onResponse);
  try {
    await page.goto(FANS_URL, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => undefined);
    if (signal?.aborted || page.isClosed()) return [];
    await wait(pending, 6_000, signal);
    if (signal?.aborted || page.isClosed()) return [];
    await page.locator('[aria-label*="filter" i], [aria-label*="Filtrar" i]').first().click({ timeout: 2_500 }).catch(() => undefined);
    await page.getByText("En línea", { exact: true }).click({ timeout: 3_000 }).catch(() => undefined);
    const arrived = page.waitForResponse(
      (response) => subscribersResponse(response.url()) === "online" && response.status() >= 200 && response.status() < 300,
      { timeout: 6_000 },
    ).catch(() => null);
    await page.getByRole("button", { name: /^aplicar$/i }).click({ timeout: 3_000 }).catch(() => undefined);
    await arrived;
    await wait(pending, 2_000);
    const chosen = filtered.length > 0 ? filtered : marked;
    return dedupe(chosen);
  } finally {
    page.off("response", onResponse);
  }
}

function listOf(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  const row = payload as Record<string, unknown>;
  for (const key of ["list", "users", "items"]) {
    if (Array.isArray(row[key])) return row[key] as unknown[];
  }
  return [];
}

function onlineFlag(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (value === 1 || value === "1" || value === "true") return true;
  if (value === 0 || value === "0" || value === "false") return false;
  return null;
}

function text(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string") return null;
  const clean = value.trim();
  return clean ? clean.slice(0, 200) : null;
}

function dedupe(rows: OnlineFan[]): OnlineFan[] {
  const map = new Map<string, OnlineFan>();
  for (const row of rows) map.set(row.fanKey, row);
  return [...map.values()].slice(0, 100);
}

function wait(pending: Array<Promise<void>>, ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  }).then(() => Promise.all(pending.splice(0))).then(() => undefined);
}
