import type { Page } from "playwright";
import type { StorageStateFile } from "../sessions/storage-state.ts";
import { sessionForApi, signedHeaders } from "./of-chat-api.ts";
import { loadSignRules, type SignRules } from "./of-sign.ts";

export type OnlineFan = {
  fanKey: string;
  fanName: string | null;
  fanHandle: string | null;
  avatarUrl: string | null;
};

export type OnlineRead = {
  fans: OnlineFan[];
  reason: string | null;
  status: number | null;
  /** false: la firma no pudo ni empezar. No se abre Chromium para taparlo. */
  fallback?: boolean;
};

/** La misma petición que Colecciones → Todo → Filtros → En línea. No es la lista «Fans». */
export const ONLINE_SUBSCRIBERS_PATH = "/api2/v2/subscriptions/subscribers?type=active&filter[online]=1";

/** Colecciones, pestaña Todo. No abre Listas de usuarios ni la lista «Fans». */
export const ONLINE_COLLECTION_URLS = [
  "https://onlyfans.com/my/collections/subscribers/active",
] as const;

/** El filtro «En línea» de Fans. Si la petición ya viene filtrada, todos cuentan. */
export function onlineFansFromPayload(payload: unknown, onlyMarked = true): OnlineFan[] {
  const rows = listOf(payload) ?? [];
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

/** 200 con lista vacía es «Nadie en línea». Sin lista reconocible no es un cero. */
export function onlineReadFromPayload(status: number, payload: unknown): OnlineRead {
  if (status === 401 || status === 400) {
    return { fans: [], reason: "OnlyFans ha rechazado la firma", status };
  }
  if (status !== 200) return { fans: [], reason: "No se pudo leer.", status };
  const rows = listOf(payload);
  if (!rows) return { fans: [], reason: "No se pudo leer.", status };
  // La petición ya lleva filter[online]=1. Si OnlyFans no manda isOnline, la fila cuenta igual.
  const fans = onlineFansFromPayload({ list: rows }, false);
  return { fans, reason: fans.length === 0 ? "Nadie en línea" : null, status };
}

/**
 * Suscriptores activos en línea, por la API firmada. No abre Chromium.
 * La firma usa la ruta con la query, el id real y `time` en milisegundos.
 */
export async function fetchSignedOnlineFans(
  state: StorageStateFile,
  deps: { fetch: typeof fetch; now: () => number; rules?: SignRules },
): Promise<OnlineRead> {
  const auth = sessionForApi(state, deps.now());
  if ("reason" in auth) return { fans: [], reason: "No se pudo leer.", status: null };
  let rules: SignRules;
  try {
    rules = deps.rules ?? await loadSignRules(deps.fetch, deps.now());
  } catch {
    return { fans: [], reason: "No se pudo leer.", status: null, fallback: false };
  }
  const headers = signedHeaders(rules, ONLINE_SUBSCRIBERS_PATH, auth, deps.now());
  let response: Response;
  try {
    response = await deps.fetch(`https://onlyfans.com${ONLINE_SUBSCRIBERS_PATH}`, {
      headers,
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    return { fans: [], reason: "No se pudo leer.", status: null };
  }
  if (response.status === 401 || response.status === 400) {
    return { fans: [], reason: "OnlyFans ha rechazado la firma", status: response.status };
  }
  if (!response.ok) return { fans: [], reason: "No se pudo leer.", status: response.status };
  try {
    return onlineReadFromPayload(response.status, await response.json());
  } catch {
    return { fans: [], reason: "No se pudo leer.", status: response.status };
  }
}

/**
 * Respaldo de la página: Colecciones, pestaña Todo, Filtros, En línea.
 * No abre la lista «Fans» de user-lists. Si el filtro no aparece, no devuelve una lista vacía.
 */
export async function readOnlineSubscribers(page: Page, signal?: AbortSignal, urls: readonly string[] = ONLINE_COLLECTION_URLS): Promise<OnlineRead> {
  if (signal?.aborted) return { fans: [], reason: "No se pudo leer.", status: null };
  const filtered: OnlineFan[] = [];
  let sawOnline = false;
  const pending: Array<Promise<void>> = [];
  const onResponse = (response: { url(): string; status(): number; text(): Promise<string> }) => {
    if (subscribersResponse(response.url()) !== "online") return;
    if (response.status() < 200 || response.status() >= 300) return;
    pending.push(response.text().then((raw) => {
      let payload: unknown;
      try {
        payload = JSON.parse(raw);
      } catch {
        return;
      }
      const rows = listOf(payload);
      if (!rows) return;
      sawOnline = true;
      filtered.push(...onlineFansFromPayload({ list: rows }, true));
    }).catch(() => undefined));
  };
  page.on("response", onResponse);
  try {
    for (const url of urls) {
      if (url.includes("/user-lists")) continue;
      if (signal?.aborted || page.isClosed()) break;
      const opened = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15_000 }).then(() => true, () => false);
      if (!opened || signal?.aborted || page.isClosed()) continue;
      await click(page.getByRole("tab", { name: /^(todo|all)$/i }));
      const filters = await click(page.getByRole("button", { name: /filtros|filters/i }));
      const filterLabel = await click(page.locator('[aria-label*="filter" i], [aria-label*="Filtrar" i], [aria-label*="Filtros" i]').first());
      if (!filters && !filterLabel) continue;
      const online = page.getByText(/^(en línea|online)$/i).first();
      if (!await click(online)) continue;
      const arrived = page.waitForResponse(
        (response) => subscribersResponse(response.url()) === "online" && response.status() >= 200 && response.status() < 300,
        { timeout: 6_000 },
      ).then(() => true, () => false);
      await click(page.getByRole("button", { name: /^(aplicar|apply)$/i }));
      await arrived;
      await wait(pending, 2_000, signal);
      if (!sawOnline) continue;
      const fans = dedupe(filtered);
      return { fans, reason: fans.length === 0 ? "Nadie en línea" : null, status: 200 };
    }
    return { fans: [], reason: "No se pudo leer.", status: null };
  } finally {
    page.off("response", onResponse);
  }
}

function listOf(payload: unknown): unknown[] | null {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return null;
  const row = payload as Record<string, unknown>;
  for (const key of ["list", "users", "items"]) {
    if (Array.isArray(row[key])) return row[key] as unknown[];
  }
  const data = row.data;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const inner = data as Record<string, unknown>;
    for (const key of ["list", "users", "items"]) {
      if (Array.isArray(inner[key])) return inner[key] as unknown[];
    }
  }
  return null;
}

async function click(locator: { click(options: { timeout: number }): Promise<void> }): Promise<boolean> {
  try {
    await locator.click({ timeout: 2_500 });
    return true;
  } catch {
    return false;
  }
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
