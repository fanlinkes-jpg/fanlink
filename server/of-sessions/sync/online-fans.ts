import type { Page } from "playwright";
import { ONLINE_FAN_CAP } from "../../../src/lib/online-fan-row.ts";
import type { StorageStateFile } from "../sessions/storage-state.ts";
import { SESSION_EXPIRED_LABEL } from "./session-link.ts";
import { sessionForApi, signedHeaders } from "./of-chat-api.ts";
import { loadSignRules, readJsonBody, type SignRules } from "./of-sign.ts";

export type OnlineFan = {
  fanKey: string;
  fanName: string | null;
  fanHandle: string | null;
  avatarUrl: string | null;
  /** Céntimos del total que manda la API. Null si el campo no viene: no se inventa. */
  spentCents: number | null;
  /** Código de OF si no es USD. Null: se pinta $. */
  currency: string | null;
  /** True solo si la fila trae isOnline u online en verdadero. */
  online: boolean;
  lists: string[];
};

export type OnlineRead = {
  fans: OnlineFan[];
  reason: string | null;
  status: number | null;
  /** false: la firma no pudo ni empezar. No se abre Chromium para taparlo. */
  fallback?: boolean;
  /** 401. El llamador marca sessionRejected y no abre Chromium. */
  sessionRejected?: boolean;
  /** 400. No es una sesión caducada. */
  signatureRejected?: boolean;
  /** 429. Cero si no hay que esperar. Con valor, no se abre Chromium. */
  retryAfterMs?: number;
};

export type OnlineAccountRead = {
  creatorId: string;
  fans: OnlineFan[];
  reason: string | null;
  status: number | null;
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
    const marked = onlineFlag(row.isOnline ?? row.online);
    if (marked === false) continue;
    if (onlyMarked && marked !== true) continue;
    const fanKey = text(row.id);
    if (!fanKey || seen.has(fanKey)) continue;
    seen.add(fanKey);
    out.push({
      fanKey,
      fanName: text(row.name ?? row.displayName),
      fanHandle: text(row.username ?? row.handle),
      avatarUrl: avatarOf(row),
      spentCents: spentCents(row),
      currency: currencyOf(row),
      online: marked === true,
      lists: listsOf(row),
    });
  }
  return out.slice(0, ONLINE_FAN_CAP);
}

export function subscribersResponse(url: string): "online" | "all" | null {
  if (!url.includes("/subscriptions/subscribers") && !url.includes("/lists/")) return null;
  if (/filter(?:\[|%5B)online(?:\]|%5D)=1|(?:^|[?&])online=1/i.test(url)) return "online";
  if (url.includes("/subscriptions/subscribers") || /\/lists\/[^/]+\/users/.test(url)) return "all";
  return null;
}

/**
 * 200 con lista vacía es «Nadie en línea». Un 401 es la sesión y un 400 es
 * la firma: no se mezclan, y ninguno de los dos es un cero.
 */
export function onlineReadFromPayload(status: number, payload: unknown): OnlineRead {
  if (status === 401) {
    return { fans: [], reason: SESSION_EXPIRED_LABEL, status, sessionRejected: true };
  }
  if (status === 400) {
    return { fans: [], reason: "OnlyFans ha rechazado la firma", status, signatureRejected: true };
  }
  if (status === 429) {
    return { fans: [], reason: "OnlyFans respondió 429", status, fallback: false, retryAfterMs: 15_000 };
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
  if (response.status === 429) {
    const paced = onlineReadFromPayload(429, null);
    return { ...paced, retryAfterMs: retryAfterMs(response), fallback: false };
  }
  if (response.status === 401 || response.status === 400) {
    return onlineReadFromPayload(response.status, null);
  }
  if (!response.ok) return { fans: [], reason: "No se pudo leer.", status: response.status, fallback: false };
  try {
    return onlineReadFromPayload(response.status, await readJsonBody(response));
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    return { fans: [], reason: "No se pudo leer.", status: response.status, ...(timedOut ? { fallback: false } : {}) };
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
      filtered.push(...onlineFansFromPayload({ list: rows }, false));
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

/**
 * Todas las cuentas: el 401 de una no esconde los fans de las que responden 200.
 * El aviso lleva el id de esa cuenta.
 */
export function mergeOnlineAccounts(reads: readonly OnlineAccountRead[]): { fans: OnlineFan[]; notices: string[] } {
  const fans: OnlineFan[] = [];
  const notices: string[] = [];
  const seen = new Set<string>();
  for (const read of reads) {
    if (read.status === 401 || read.reason === SESSION_EXPIRED_LABEL) {
      notices.push(`${read.creatorId}: ${SESSION_EXPIRED_LABEL}`);
      continue;
    }
    if (read.fans.length === 0 && read.reason && read.reason !== "Nadie en línea") {
      notices.push(`${read.creatorId}: ${read.reason}`);
      continue;
    }
    for (const fan of read.fans) {
      const key = `${read.creatorId}:${fan.fanKey}`;
      if (seen.has(key)) continue;
      seen.add(key);
      fans.push(fan);
    }
  }
  return { fans, notices };
}

function retryAfterMs(response: Response): number {
  const header = response.headers.get("retry-after");
  const seconds = Number(header);
  if (header && Number.isFinite(seconds) && seconds >= 0) return Math.min(Math.round(seconds * 1000), 30 * 60_000);
  return 15_000;
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

function currencyOf(row: Record<string, unknown>): string | null {
  const nested = asRecord(row.subscribedOnData) ?? asRecord(row.subscribedByData);
  const raw = text(row.currency ?? nested?.currency);
  if (!raw) return null;
  const code = raw.toUpperCase();
  if (code === "USD" || code === "$") return null;
  return /^[A-Z]{3}$/.test(code) ? code : null;
}

function spentCents(row: Record<string, unknown>): number | null {
  const nested = asRecord(row.subscribedOnData) ?? asRecord(row.subscribedByData);
  return money(row.totalSumm ?? row.spent ?? row.totalSpent ?? nested?.totalSumm ?? nested?.spent ?? nested?.totalSpent);
}

function money(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return Math.round(value * 100);
  if (typeof value === "string" && /^\d+(\.\d{1,2})?$/.test(value.trim())) return Math.round(Number(value.trim()) * 100);
  return null;
}

function listsOf(row: Record<string, unknown>): string[] {
  const source = Array.isArray(row.listsStates) ? row.listsStates : Array.isArray(row.lists) ? row.lists : [];
  const names: string[] = [];
  for (const item of source) {
    const record = asRecord(item);
    if (!record || record.hasUser === false) continue;
    const name = text(record.name);
    if (!name || names.includes(name)) continue;
    names.push(name);
  }
  return names.slice(0, 12);
}

function avatarOf(row: Record<string, unknown>): string | null {
  const direct = httpsUrl(row.avatar);
  if (direct) return direct;
  const thumbs = asRecord(row.avatarThumbs);
  return thumbs ? (httpsUrl(thumbs.c144) ?? httpsUrl(thumbs.c50)) : null;
}

function httpsUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const clean = value.trim();
  if (!/^https:\/\//i.test(clean) || clean.length > 400) return null;
  return clean;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
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
  return [...map.values()].slice(0, ONLINE_FAN_CAP);
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
