import { BROWSER_FINGERPRINT } from "../sessions/browser-factory.ts";
import { domainMatches, isCookieUnexpired, type StorageCookie, type StorageStateFile } from "../sessions/storage-state.ts";
import { backoffDelayMs } from "./backoff.ts";
import { mergeMessages, mergeThreads, parseChatList, parseChatMessages, parsePreviewMessages, type ChatMessage, type ChatThread } from "./chats.ts";
import { awaitAccountGap, REQUEST_GAP_MS } from "./api-list-pace.ts";
import { headerRemoved, loadSignRules, normalizeHeaderName, pathHasQuery, signOnlyfans, type SignRules } from "./of-sign.ts";

const HOST = "onlyfans.com";

export const CHAT_LIST_PAGE = 20;
export const DEFAULT_CHAT_LIST_CAP = 60;
export const DEFAULT_MESSAGE_PAGE_CAP = 1;
const MESSAGE_PAGE = 10;
const MAX_OPEN_THREADS = 20;
const MAX_LIST_CAP = 500;
const MAX_MESSAGE_PAGES = 3;
const MAX_RETRY_MS = 30 * 60_000;

export type SignedChats = {
  threads: ChatThread[];
  messages: ChatMessage[];
  reason: string | null;
  /** 401 de OnlyFans. El llamador marca Expirada o Pendiente de login y no abre Chromium. */
  sessionRejected: boolean;
  /** 429. Cero si no hay que esperar. */
  retryAfterMs: number;
  /** 400. La fila muestra el motivo y el ciclo espera el backoff. */
  signatureRejected: boolean;
  /**
   * Cookies de Set-Cookie. No se escriben aquí.
   * El encargo 1-1 (rama grok/fase1-perfil-chromium, un Chromium por perfil
   * y el JSON de sesión al día) es quien debe guardarlas en el JSON cifrado.
   * Este módulo no toca data/sessions ni FANLINK_SESSION_KEY.
   */
  rotatedCookies: StorageCookie[];
};

export type SignedChatOptions = {
  /** Hilos que el chatter tiene abiertos. Solo la primera página de mensajes. */
  openThreadKeys?: readonly string[];
  /** full pagina hasta el tope; head es solo offset 0; none no pide la lista. */
  list?: "full" | "head" | "none";
  /** open pide la primera página de los hilos abiertos. */
  messages?: "open" | "none";
  /** Tope de hilos de la lista. También vale FANLINK_CHAT_LIST_CAP. */
  listCap?: number;
  /** Páginas de mensajes por hilo. Tope 3. El ritmo normal usa 1. */
  messagePageCap?: number;
};

export type SignedChatDeps = {
  fetch: typeof fetch;
  now: () => number;
  /** Reglas ya leídas. Si no vienen, se piden a DATAHOARDERS. */
  rules?: SignRules;
  /** Si viene, separa las peticiones de esta cuenta, también entre llamadas. */
  sleep?: (ms: number) => Promise<void>;
  minGapMs?: number;
  accountId?: string;
};

export function sessionForApi(state: StorageStateFile, nowMs: number): { cookie: string; userId: string; xBc: string } | { reason: string } {
  const cookies = state.cookies.filter((cookie) => domainMatches(cookie.domain, HOST) && isCookieUnexpired(cookie.expires, nowMs));
  const userId = cookies.find((cookie) => cookie.name === "auth_id")?.value ?? "";
  if (!userId || !cookies.some((cookie) => cookie.name === "sess")) return { reason: "la sesión guardada no tiene auth_id y sess" };
  const stored = state.origins.flatMap((origin) => origin.localStorage);
  const xBc = stored.find((item) => item.name === "bcTokenSha" || item.name === "fp")?.value
    ?? cookies.find((cookie) => cookie.name === "fp" || cookie.name === "x-bc")?.value
    ?? "";
  if (!xBc) return { reason: "falta la huella x-bc de la sesión" };
  return { cookie: cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; "), userId, xBc };
}

/** Única función que arma las cabeceras firmadas. `signOnlyfans` solo calcula sign y time. */
export function signedHeaders(rules: SignRules, pathWithQuery: string, auth: { cookie: string; userId: string; xBc: string }, timeMs: number): Record<string, string> {
  const signed = signOnlyfans(rules, pathWithQuery, auth.userId, timeMs);
  const headers: Record<string, string> = {
    accept: "application/json, text/plain, */*",
    "app-token": rules.appToken,
    cookie: auth.cookie,
    sign: signed.sign,
    time: signed.time,
    "user-agent": BROWSER_FINGERPRINT.userAgent,
    "x-bc": auth.xBc,
    referer: "https://onlyfans.com/",
    "user-id": auth.userId,
  };
  if (!pathHasQuery(pathWithQuery)) {
    for (const name of rules.removeHeaders) {
      delete headers[normalizeHeaderName(name)];
    }
    if (headerRemoved(rules, "user-id")) delete headers["user-id"];
  }
  return headers;
}

export async function fetchSignedChats(state: StorageStateFile, deps: SignedChatDeps, options: SignedChatOptions = {}): Promise<SignedChats> {
  const auth = sessionForApi(state, deps.now());
  if ("reason" in auth) return emptySigned(auth.reason);
  const rules = deps.rules ?? await loadSignRules(deps.fetch, deps.now());
  const cap = listCapOf(options);
  const pageCap = messagePageCapOf(options);
  const opened = openThreadKeys(options);
  const listMode = options.list ?? "full";
  const messageMode = options.messages ?? (opened.length > 0 ? "open" : "none");
  let threads: ChatThread[] = [];
  let messages: ChatMessage[] = [];
  const rotatedCookies: StorageCookie[] = [];
  let lastRequestAt = 0;

  let failure: string | null = null;
  const take = (page: JsonPage): SignedChats | null => {
    rotatedCookies.push(...page.rotatedCookies);
    if (!fatalPage(page)) return null;
    return {
      threads,
      messages,
      reason: page.reason,
      sessionRejected: page.sessionRejected,
      signatureRejected: page.signatureRejected,
      retryAfterMs: page.retryAfterMs,
      rotatedCookies,
    };
  };

  const request = async (path: string): Promise<JsonPage> => {
    const gap = deps.sleep ? (deps.minGapMs ?? REQUEST_GAP_MS) : 0;
    if (gap > 0 && deps.sleep) {
      if (deps.accountId) await awaitAccountGap(deps.accountId, deps.now, deps.sleep, gap);
      else if (lastRequestAt > 0) {
        const wait = gap - (deps.now() - lastRequestAt);
        if (wait > 0) await deps.sleep(wait);
      }
    }
    const page = await getJson(deps.fetch, path, signedHeaders(rules, path, auth, deps.now()), deps.now());
    lastRequestAt = deps.now();
    return page;
  };

  if (messageMode === "open") {
    for (const threadKey of opened) {
      const read = await readMessagePages(request, threadKey, threadKey, auth.userId, pageCap);
      messages = mergeMessages(messages, read.messages);
      const stopped = take(read.page);
      if (stopped) return stopped;
    }
  }

  if (listMode !== "none") {
    const maxPages = listMode === "head" ? 1 : Math.ceil(cap / CHAT_LIST_PAGE);
    let offset = 0;
    let pages = 0;
    const known = new Set<string>();
    while (pages < maxPages && threads.length < cap) {
      pages += 1;
      const listPath = `/api2/v2/chats?limit=${CHAT_LIST_PAGE}&offset=${offset}&skip_users=none&order=recent`;
      const list = await request(listPath);
      const stopped = take(list);
      if (stopped) return stopped;
      if (!list.ok) {
        failure = list.reason;
        break;
      }
      const pageThreads = parseChatList(list.body, auth.userId);
      const fresh = pageThreads.filter((thread) => !known.has(thread.threadKey));
      if (fresh.length === 0) break;
      for (const thread of fresh) known.add(thread.threadKey);
      threads = mergeThreads(threads, fresh);
      messages = mergeMessages(messages, parsePreviewMessages(list.body, auth.userId));
      if (threads.length >= cap) break;
      if (!listHasMore(list.body, pageThreads.length)) break;
      const next = nextListOffset(list.body, offset);
      if (next <= offset) break;
      offset = next;
    }
  }

  const nothing = threads.length === 0 && messages.length === 0;
  return {
    threads,
    messages,
    reason: nothing ? failure : null,
    sessionRejected: false,
    signatureRejected: false,
    retryAfterMs: 0,
    rotatedCookies,
  };
}

/**
 * Las mismas dos rutas de siempre, una vez cada una. No relee miniaturas:
 * eso es el encargo de la bóveda, no el de la lista de chats.
 */
export async function fetchSignedVault(state: StorageStateFile, deps: {
  fetch: typeof fetch;
  now: () => number;
}, listId = "all", offset = 0): Promise<unknown[]> {
  const auth = sessionForApi(state, deps.now());
  if ("reason" in auth) return [];
  const rules = await loadSignRules(deps.fetch, deps.now());
  const list = listId.trim().slice(0, 80) || "all";
  const skip = Number.isFinite(offset) && offset > 0 ? Math.min(2_000, Math.floor(offset)) : 0;
  const paths = [
    ...(skip === 0 ? ["/api2/v2/vault/lists?view=main&offset=0&limit=100"] : []),
    `/api2/v2/vault/media?limit=40&offset=${skip}&field=recent&sort=desc&list=${encodeURIComponent(list)}`,
  ];
  const payloads: unknown[] = [];
  for (const path of paths) {
    const read = await getJson(deps.fetch, path, signedHeaders(rules, path, auth, deps.now()), deps.now());
    if (read.ok) payloads.push(read.body);
  }
  return payloads;
}

type JsonPage = {
  ok: boolean;
  body: unknown;
  reason: string;
  status: number;
  sessionRejected: boolean;
  signatureRejected: boolean;
  retryAfterMs: number;
  rotatedCookies: StorageCookie[];
};

async function readMessagePages(
  request: (path: string) => Promise<JsonPage>,
  threadKey: string,
  fanKey: string | null,
  accountUserId: string,
  pageCap: number,
): Promise<{ page: JsonPage; messages: ChatMessage[] }> {
  const messages: ChatMessage[] = [];
  let cursor: string | null = null;
  let page: JsonPage = {
    ok: true,
    body: null,
    reason: "",
    status: 200,
    sessionRejected: false,
    signatureRejected: false,
    retryAfterMs: 0,
    rotatedCookies: [],
  };
  for (let index = 0; index < pageCap; index += 1) {
    page = await request(messagesPath(threadKey, cursor));
    if (!page.ok) return { page, messages };
    messages.push(...parseChatMessages(page.body, threadKey, fanKey, accountUserId));
    if (!messageHasMore(page.body)) break;
    const next = messageCursor(page.body);
    if (!next || next === cursor) break;
    cursor = next;
  }
  return { page, messages };
}

async function getJson(fetchImpl: typeof fetch, pathWithQuery: string, headers: Record<string, string>, nowMs: number): Promise<JsonPage> {
  const response = await fetchImpl(`https://onlyfans.com${pathWithQuery}`, { headers });
  const rotatedCookies = setCookieLines(response).flatMap((line) => {
    const cookie = parseSetCookieLine(line, nowMs);
    return cookie ? [cookie] : [];
  });
  if (response.status === 401) {
    return { ok: false, body: null, reason: "OnlyFans ha rechazado la sesión (401). Pulsa Reconectar.", status: 401, sessionRejected: true, signatureRejected: false, retryAfterMs: 0, rotatedCookies };
  }
  if (response.status === 400) {
    return { ok: false, body: null, reason: "OnlyFans rechazó la firma", status: 400, sessionRejected: false, signatureRejected: true, retryAfterMs: 0, rotatedCookies };
  }
  if (response.status === 429) {
    return { ok: false, body: null, reason: "OnlyFans respondió 429", status: 429, sessionRejected: false, signatureRejected: false, retryAfterMs: retryAfterMs(response, nowMs), rotatedCookies };
  }
  if (!response.ok) {
    return { ok: false, body: null, reason: `OnlyFans respondió ${response.status}`, status: response.status, sessionRejected: false, signatureRejected: false, retryAfterMs: 0, rotatedCookies };
  }
  try {
    return { ok: true, body: await response.json(), reason: "", status: response.status, sessionRejected: false, signatureRejected: false, retryAfterMs: 0, rotatedCookies };
  } catch {
    return { ok: false, body: null, reason: "OnlyFans no devolvió JSON", status: response.status, sessionRejected: false, signatureRejected: false, retryAfterMs: 0, rotatedCookies };
  }
}

function fatalPage(page: JsonPage): boolean {
  return !page.ok && (page.sessionRejected || page.signatureRejected || page.retryAfterMs > 0);
}

function emptySigned(reason: string | null): SignedChats {
  return { threads: [], messages: [], reason, sessionRejected: false, signatureRejected: false, retryAfterMs: 0, rotatedCookies: [] };
}

function listCapOf(options: SignedChatOptions): number {
  const fromEnv = Number(process.env.FANLINK_CHAT_LIST_CAP);
  const raw = options.listCap ?? (Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : DEFAULT_CHAT_LIST_CAP);
  return Math.min(MAX_LIST_CAP, Math.max(1, Math.floor(raw)));
}

/**
 * Páginas de `/messages` por hilo cuando el llamador no fija `messagePageCap`.
 * `FANLINK_CHAT_MESSAGE_PAGES` vale 1, 2 o 3. El ritmo de la bandeja pasa 1:
 * solo la primera página de los hilos abiertos. De un hilo que nadie tiene
 * abierto no se pide `/messages`: de la lista se guarda el último mensaje.
 */
function messagePageCapOf(options: SignedChatOptions): number {
  const fromEnv = Number(process.env.FANLINK_CHAT_MESSAGE_PAGES);
  const raw = options.messagePageCap ?? (Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : DEFAULT_MESSAGE_PAGE_CAP);
  return Math.min(MAX_MESSAGE_PAGES, Math.max(1, Math.floor(raw)));
}

function openThreadKeys(options: SignedChatOptions): string[] {
  const seen = new Set<string>();
  const keys: string[] = [];
  for (const key of options.openThreadKeys ?? []) {
    const clean = key.trim().slice(0, 40);
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    keys.push(clean);
    if (keys.length >= MAX_OPEN_THREADS) break;
  }
  return keys;
}

function messagesPath(threadKey: string, cursor: string | null): string {
  const cursorQuery = cursor ? `&id=${encodeURIComponent(cursor)}` : "";
  return `/api2/v2/chats/${encodeURIComponent(threadKey)}/messages?limit=${MESSAGE_PAGE}&order=desc&skip_users=all${cursorQuery}`;
}

function listHasMore(body: unknown, count: number): boolean {
  if (!body || typeof body !== "object") return false;
  const raw = body as Record<string, unknown>;
  if (raw.hasMore === false || raw.has_more === false) return false;
  if (raw.hasMore === true || raw.has_more === true) return true;
  return count >= CHAT_LIST_PAGE;
}

function nextListOffset(body: unknown, offset: number): number {
  if (body && typeof body === "object") {
    const raw = body as Record<string, unknown>;
    const cursor = raw.nextOffset ?? raw.next_offset;
    if (typeof cursor === "number" && Number.isFinite(cursor) && cursor > offset) return Math.floor(cursor);
  }
  return offset + CHAT_LIST_PAGE;
}

function messageHasMore(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const raw = body as Record<string, unknown>;
  return raw.hasMore === true || raw.has_more === true;
}

function messageCursor(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const raw = body as Record<string, unknown>;
  const explicit = raw.nextLastId ?? raw.lastId ?? raw.cursor;
  if (typeof explicit === "number" || (typeof explicit === "string" && explicit.trim())) return String(explicit).trim();
  const list = Array.isArray(raw.list) ? raw.list : [];
  let oldest: string | null = null;
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const id = (item as Record<string, unknown>).id;
    if (typeof id === "number" || typeof id === "string") oldest = String(id);
  }
  return oldest;
}

function retryAfterMs(response: Response, nowMs: number): number {
  const header = response.headers.get("retry-after");
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(Math.round(seconds * 1000), MAX_RETRY_MS);
    const at = Date.parse(header);
    if (Number.isFinite(at)) return Math.min(Math.max(0, at - nowMs), MAX_RETRY_MS);
  }
  return backoffDelayMs(0);
}

function setCookieLines(response: Response): string[] {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof headers.getSetCookie === "function") {
    const lines = headers.getSetCookie();
    if (lines.length > 0) return lines;
  }
  const single = response.headers.get("set-cookie");
  return single ? [single] : [];
}

/**
 * Una línea Set-Cookie de OnlyFans, lista para el JSON de sesión.
 * No escribe el archivo: eso es el encargo 1-1.
 */
export function parseSetCookieLine(line: string, nowMs: number): StorageCookie | null {
  const parts = line.split(";").map((part) => part.trim()).filter(Boolean);
  const first = parts[0];
  if (!first) return null;
  const eq = first.indexOf("=");
  if (eq <= 0) return null;
  const name = first.slice(0, eq).trim();
  const value = first.slice(eq + 1).trim();
  if (!name || /[\r\n]/.test(name) || /[\r\n]/.test(value)) return null;
  let domain = ".onlyfans.com";
  let path = "/";
  let expires = -1;
  let httpOnly = false;
  let secure = false;
  let sameSite: StorageCookie["sameSite"] = "Lax";
  for (const part of parts.slice(1)) {
    const splitAt = part.indexOf("=");
    const key = (splitAt === -1 ? part : part.slice(0, splitAt)).trim().toLowerCase();
    const val = splitAt === -1 ? "" : part.slice(splitAt + 1).trim();
    if (key === "domain" && val) domain = val;
    else if (key === "path" && val) path = val;
    else if (key === "max-age") {
      const seconds = Number(val);
      if (Number.isFinite(seconds)) expires = Math.floor(nowMs / 1000) + Math.floor(seconds);
    } else if (key === "expires") {
      const at = Date.parse(val);
      if (Number.isFinite(at)) expires = Math.floor(at / 1000);
    } else if (key === "httponly") httpOnly = true;
    else if (key === "secure") secure = true;
    else if (key === "samesite") {
      const site = val.toLowerCase();
      sameSite = site === "strict" ? "Strict" : site === "none" ? "None" : "Lax";
    }
  }
  if (!domainMatches(domain, HOST)) return null;
  return { name, value, domain, path, expires, httpOnly, secure, sameSite };
}
