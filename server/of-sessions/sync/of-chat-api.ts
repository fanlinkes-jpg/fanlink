import { BROWSER_FINGERPRINT } from "../sessions/browser-factory.ts";
import { domainMatches, isCookieUnexpired, type StorageCookie, type StorageStateFile } from "../sessions/storage-state.ts";
import { backoffDelayMs } from "./backoff.ts";
import { mergeMessages, mergeThreads, parseChatList, parseChatMessages, parsePreviewMessages, type ChatMessage, type ChatThread } from "./chats.ts";
import { collectFanSpend } from "./fan-spend.ts";
import { awaitAccountGap, REQUEST_GAP_MS, withAccountApi } from "./api-list-pace.ts";
import { noteMissingUnread } from "./unread-chats.ts";
import { usersMeKeepsSession, usersMeVerdict } from "../identity.ts";
import { loadSignRules, signedUserId, signOnlyfans, type SignRules } from "./of-sign.ts";
import { vaultFolderMark } from "./vault-model.ts";
import { SESSION_EXPIRED_LABEL } from "./session-link.ts";

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
  /** Hubo al menos un HTTP 200. Un 401 no cuenta como lectura buena. */
  accepted?: boolean;
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
  /** Solo para el log si falta unreadMessagesCount. No entra en el motivo. */
  creatorId?: string | null;
  log?: (line: string) => void;
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
    "user-id": signedUserId(auth.userId),
  };
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
  let accepted = false;

  let failure: string | null = null;
  const take = (page: JsonPage): SignedChats | null => {
    rotatedCookies.push(...page.rotatedCookies);
    if (page.ok && page.status === 200) accepted = true;
    if (!fatalPage(page)) return null;
    return {
      threads,
      messages,
      reason: page.reason,
      sessionRejected: page.sessionRejected,
      signatureRejected: page.signatureRejected,
      retryAfterMs: page.retryAfterMs,
      rotatedCookies,
      accepted,
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

  if (threads.length > 0 && deps.accountId) {
    const filled = await collectFanSpend({
      accountId: deps.accountId,
      creatorId: deps.creatorId ?? "",
      threads,
      visibleIds: [],
      request: async (path) => {
        const page = await request(path);
        return {
          ok: page.ok,
          status: page.status,
          body: page.body,
          retryAfterMs: page.retryAfterMs,
          sessionRejected: page.sessionRejected,
        };
      },
      now: deps.now(),
      log: deps.log,
    });
    threads = threads.map((thread) => {
      if (thread.spentCents != null || !thread.fanKey) return thread;
      const cents = filled.byFan.get(thread.fanKey);
      return cents == null ? thread : { ...thread, spentCents: cents };
    });
    if (filled.stopped && (filled.stopped.sessionRejected || filled.stopped.retryAfterMs > 0 || filled.stopped.status === 400)) {
      const stopped = take({
        ok: false,
        body: null,
        reason: filled.stopped.sessionRejected ? "OnlyFans ha rechazado la sesión (401). Pulsa Reconectar." : filled.stopped.status === 400 ? "OnlyFans rechazó la firma" : "OnlyFans respondió 429",
        status: filled.stopped.status,
        sessionRejected: filled.stopped.sessionRejected,
        signatureRejected: filled.stopped.status === 400,
        retryAfterMs: filled.stopped.retryAfterMs,
        rotatedCookies: [],
      });
      if (stopped) return { ...stopped, threads };
    }
  }

  const nothing = threads.length === 0 && messages.length === 0;
  noteMissingUnread(deps.creatorId, threads.filter((thread) => thread.unread == null).length);
  return {
    threads,
    messages,
    reason: nothing ? failure : null,
    sessionRejected: false,
    signatureRejected: false,
    retryAfterMs: 0,
    rotatedCookies,
    accepted,
  };
}

export type SignedVaultRead = {
  payloads: unknown[];
  status: number | null;
  reason: string | null;
  sessionRejected: boolean;
  signatureRejected: boolean;
  retryAfterMs: number;
  /** Parámetro que salió en la URL de vault/media. `list` también es el reintento. */
  queryParam: "list" | "list_id" | null;
};

export type VaultFetchOptions = {
  /** false: no pide vault/lists. Por defecto se pide solo en offset 0. */
  includeLists?: boolean;
  /** false: no pide vault/media. */
  includeMedia?: boolean;
  /** Página de vault/lists. El límite es el de la web: 50. */
  listOffset?: number;
  /** Nombre de la carpeta. Solo entra en la URL de reintento; no se escribe en el log. */
  listName?: string | null;
  /** El catálogo trae fotos, vídeos, GIF o audios. Un 200 vacío prueba la otra URL. */
  expectMedia?: boolean;
}

/** La web pide las carpetas de 50 en 50 (`view=main`) y sigue con offset mientras `hasMore`. */
export const VAULT_LIST_LIMIT = 50;
/**
 * La web pagina con `limit` 40, `offset` y `sort=desc`.
 * La web pide `limit`, `offset`, `field=recent`, `sort=desc` y `list`.
 * `list=all` es Toda la bóveda. Una carpeta usa el mismo parámetro con su id.
 * No va `type` ni `list_id`.
 */
export const VAULT_MEDIA_LIMIT = 40;

export function vaultListsPath(offset: number): string {
  return `/api2/v2/vault/lists?view=main&offset=${offset}&limit=${VAULT_LIST_LIMIT}`;
}

/** La misma query que la bóveda web: `field=recent`, `sort=desc` y `list`. */
export function vaultMediaPath(listId: string, offset: number, name?: string | null): string {
  const params = new URLSearchParams({
    limit: String(VAULT_MEDIA_LIMIT),
    offset: String(offset),
    field: "recent",
    sort: "desc",
    list: listId.trim() || "all",
  });
  const label = name?.trim();
  if (label) params.set("name", label);
  return `/api2/v2/vault/media?${params.toString()}`;
}

/** Medios de una carpeta o subcarpeta. La web abre `lists/{id}/media`, no `vault/media?list=`. */
export function vaultListMediaPath(listId: string, offset: number): string {
  const id = listId.trim();
  const params = new URLSearchParams({
    limit: String(VAULT_MEDIA_LIMIT),
    offset: String(offset),
    list: id,
    field: "recent",
    sort: "desc",
  });
  return `/api2/v2/vault/lists/${encodeURIComponent(id)}/media?${params.toString()}`;
}

/** Un medio de la bóveda. La web lo pide al abrir un vídeo cuyo listado no trae URL. */
export function vaultMediaDetailPath(mediaId: string): string {
  const id = mediaId.trim();
  return `/api2/v2/vault/media/${encodeURIComponent(id)}`;
}

/** Ruta, estado y conteos. Sin query firmada ni cookies. */
export function vaultPageLog(input: {
  route: string;
  status: number | null;
  count: number;
  hasMore: string;
  offset: number;
  listId: string;
  reason?: string | null;
}): string {
  const route = publicVaultRoute(input.route, input.listId);
  const listId = input.listId === "listas" ? "listas" : vaultFolderMark(input.listId);
  return `[fanlink:vault] pagina ruta=${route} status=${input.status ?? "sin"} motivo=${vaultPageReason(input.reason)} n=${input.count} hasMore=${input.hasMore} offset=${input.offset} list=${listId}`;
}

/** Motivo corto. Sin URL, cookie, firma, id ni nombre de carpeta. */
export function vaultPageReason(reason: string | null | undefined): string {
  if (!reason) return "sin";
  const clean = reason
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/cookie|sign|sess|x-bc|token|user-agent|name=/gi, "")
    .replace(/[^a-zA-Z0-9 áéíóúñÁÉÍÓÚÑ.-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return clean || "sin";
}

function publicVaultRoute(route: string, listId: string): string {
  const path = route.split("?")[0] || "/api2/v2/vault/media";
  if (listId === "all" || listId === "listas") return path;
  if (path.includes("/vault/lists/") && path.endsWith("/media")) return "/api2/v2/vault/lists/{carpeta}/media";
  if (path.startsWith("/api2/v2/vault/media")) return "/api2/v2/vault/media";
  return "/api2/v2/vault/media";
}

/**
 * Una página de `vault/lists` y/o `vault/media`. No relee miniaturas.
 * El estado HTTP sale en el resultado: un 401 no es una lista vacía.
 * Quien quiera el resto de las páginas llama otra vez con el offset siguiente.
 */
export async function fetchSignedVault(state: StorageStateFile, deps: {
  fetch: typeof fetch;
  now: () => number;
  /** Misma cola que el chat: una petición firmada a la vez y 300 ms entre ellas. */
  accountId?: string;
  sleep?: (ms: number) => Promise<void>;
}, listId = "all", offset = 0, options?: VaultFetchOptions): Promise<SignedVaultRead> {
  const empty: SignedVaultRead = {
    payloads: [],
    status: null,
    reason: null,
    sessionRejected: false,
    signatureRejected: false,
    retryAfterMs: 0,
    queryParam: null,
  };
  const auth = sessionForApi(state, deps.now());
  if ("reason" in auth) return { ...empty, reason: auth.reason };
  const rules = await loadSignRules(deps.fetch, deps.now());
  const list = listId.trim().slice(0, 80) || "all";
  const skip = Number.isFinite(offset) && offset > 0 ? Math.min(2_000, Math.floor(offset)) : 0;
  const listSkip = Number.isFinite(options?.listOffset) && (options?.listOffset ?? 0) > 0
    ? Math.min(2_000, Math.floor(options?.listOffset ?? 0))
    : 0;
  const wantLists = options?.includeLists ?? skip === 0;
  const wantMedia = options?.includeMedia !== false;
  const payloads: unknown[] = [];
  let status: number | null = null;
  if (wantLists) {
    const path = vaultListsPath(listSkip);
    const read = await readVaultPath(deps, () => getJson(deps.fetch, path, signedHeaders(rules, path, auth, deps.now()), deps.now()));
    status = read.status;
    console.info(vaultPageLog({ route: path, status: read.status, count: listCountOf(read.body), hasMore: hasMoreLabelOf(read.body), offset: listSkip, listId: "listas", reason: read.reason }));
    const stopped = stopVaultRead(payloads, read);
    if (stopped) return stopped;
    if (read.ok) payloads.push(read.body);
    else return { ...empty, status: read.status, reason: read.reason };
  }
  let queryParam: "list" | "list_id" | null = null;
  if (wantMedia) {
    const primary = list === "all" ? vaultMediaPath(list, skip) : vaultListMediaPath(list, skip);
    queryParam = "list";
    let read = await readVaultPath(deps, () => getJson(deps.fetch, primary, signedHeaders(rules, primary, auth, deps.now()), deps.now()));
    logVaultPage(list, primary, read, skip);
    const listed = folderListedCounts(payloads, list);
    const catalogHasMedia = options?.expectMedia === true || (listed != null && listed.total > 0);
    const emptyCounted = read.ok && mediaCountOf(read.body) === 0 && catalogHasMedia;
    if (list !== "all" && mediaCountOf(read.body) === 0 && (clientFolderMiss(read) || emptyCounted)) {
      const folderName = options?.listName?.trim() || nameFromLists(payloads, list);
      const webPath = vaultMediaPath(list, skip);
      if (deps.sleep) await deps.sleep(800);
      const web = await readVaultPath(deps, () => getJson(deps.fetch, webPath, signedHeaders(rules, webPath, auth, deps.now()), deps.now()));
      logVaultPage(list, webPath, web, skip);
      if (mediaCountOf(web.body) > 0) {
        read = web;
      } else if (folderName) {
        const namedPath = vaultMediaPath(list, skip, folderName);
        if (deps.sleep) await deps.sleep(800);
        const named = await readVaultPath(deps, () => getJson(deps.fetch, namedPath, signedHeaders(rules, namedPath, auth, deps.now()), deps.now()));
        logVaultPage(list, namedPath, named, skip);
        if (mediaCountOf(named.body) > 0) read = named;
      }
    }
    status = read.status;
    const stopped = stopVaultRead(payloads, read, queryParam);
    if (stopped) return stopped;
    if (read.ok) payloads.push(read.body);
    else return { ...empty, payloads, status: read.status, reason: read.reason, queryParam };
  }
  return { ...empty, payloads, status, queryParam, reason: payloads.length === 0 ? "No se ha podido leer la bóveda." : null };
}

/** Detalle firmado de un medio. No registra la URL ni el id. */
export async function fetchSignedMediaDetail(state: StorageStateFile, deps: {
  fetch: typeof fetch;
  now: () => number;
  accountId?: string;
  sleep?: (ms: number) => Promise<void>;
}, mediaId: string): Promise<{ status: number | null; body: unknown; reason: string | null }> {
  const auth = sessionForApi(state, deps.now());
  if ("reason" in auth) return { status: null, body: null, reason: auth.reason };
  const rules = await loadSignRules(deps.fetch, deps.now());
  const path = vaultMediaDetailPath(mediaId);
  const read = await readVaultPath(deps, () => getJson(deps.fetch, path, signedHeaders(rules, path, auth, deps.now()), deps.now()));
  console.info(`[fanlink:vault] video medio=${vaultFolderMark(mediaId)} detalle status=${read.status || "sin"}`);
  if (!read.ok) return { status: read.status, body: null, reason: read.reason };
  return { status: read.status, body: read.body, reason: null };
}

function stopVaultRead(payloads: unknown[], read: JsonPage, queryParam: "list" | "list_id" | null = null): SignedVaultRead | null {
  if (read.sessionRejected) {
    return { payloads, status: 401, reason: SESSION_EXPIRED_LABEL, sessionRejected: true, signatureRejected: false, retryAfterMs: 0, queryParam };
  }
  if (read.signatureRejected) {
    return { payloads, status: 400, reason: "OnlyFans ha rechazado la firma", sessionRejected: false, signatureRejected: true, retryAfterMs: 0, queryParam };
  }
  if (read.retryAfterMs > 0) {
    return { payloads, status: 429, reason: "OnlyFans respondió 429", sessionRejected: false, signatureRejected: false, retryAfterMs: read.retryAfterMs, queryParam };
  }
  return null;
}

function listCountOf(body: unknown): number {
  if (!body || typeof body !== "object") return 0;
  const raw = body as Record<string, unknown>;
  if (Array.isArray(raw.list)) return raw.list.length;
  if (Array.isArray(raw.lists)) return raw.lists.length;
  return 0;
}

function mediaCountOf(body: unknown): number {
  if (!body || typeof body !== "object") return 0;
  const raw = body as Record<string, unknown>;
  for (const key of ["medias", "list", "media", "items"]) {
    const value = raw[key];
    if (Array.isArray(value) && value.length > 0) return value.length;
  }
  for (const key of ["medias", "list", "media", "items"]) {
    if (Array.isArray(raw[key])) return 0;
  }
  return 0;
}

function clientFolderMiss(read: JsonPage): boolean {
  return read.status != null && read.status >= 400 && read.status < 500 && read.status !== 401 && read.status !== 429;
}

function logVaultPage(list: string, route: string, read: JsonPage, offset: number): void {
  console.info(vaultPageLog({
    route,
    status: read.status,
    count: mediaCountOf(read.body),
    hasMore: hasMoreLabelOf(read.body),
    offset,
    listId: list,
    reason: read.reason,
  }));
}

function folderListedCounts(payloads: readonly unknown[], listId: string): { total: number } | null {
  for (const payload of payloads) {
    if (!payload || typeof payload !== "object") continue;
    const raw = payload as Record<string, unknown>;
    const rows = [raw.list, raw.lists].find((value) => Array.isArray(value));
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      const item = row as Record<string, unknown>;
      if (String(item.id) !== listId) continue;
      const total = countField(item.photosCount ?? item.photos)
        + countField(item.videosCount ?? item.videos)
        + countField(item.gifsCount ?? item.gifs)
        + countField(item.audiosCount ?? item.audios);
      return { total };
    }
  }
  return null;
}

function countField(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

function folderMediaRoute(pathWithQuery: string): boolean {
  const path = pathWithQuery.split("?")[0] ?? "";
  if (/^\/api2\/v2\/vault\/lists\/[^/]+\/media$/.test(path)) return true;
  if (path !== "/api2/v2/vault/media") return false;
  const list = new URLSearchParams(pathWithQuery.split("?")[1] ?? "").get("list");
  return list != null && list !== "" && list !== "all";
}

function nameFromLists(payloads: readonly unknown[], listId: string): string | null {
  for (const payload of payloads) {
    if (!payload || typeof payload !== "object") continue;
    const raw = payload as Record<string, unknown>;
    const rows = [raw.list, raw.lists].find((value) => Array.isArray(value));
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      const item = row as Record<string, unknown>;
      if (String(item.id) !== listId) continue;
      if (typeof item.name === "string" && item.name.trim()) return item.name.trim();
    }
  }
  return null;
}

function hasMoreLabelOf(body: unknown): string {
  if (!body || typeof body !== "object") return "ausente";
  const raw = body as Record<string, unknown>;
  if (!("hasMore" in raw) && !("has_more" in raw)) return "ausente";
  return raw.hasMore === true || raw.has_more === true ? "si" : "no";
}

async function readVaultPath(deps: {
  accountId?: string;
  now: () => number;
  sleep?: (ms: number) => Promise<void>;
}, load: () => Promise<JsonPage>): Promise<JsonPage> {
  if (!deps.accountId) return load();
  const accountId = deps.accountId;
  return withAccountApi(accountId, async () => {
    if (deps.sleep) await awaitAccountGap(accountId, deps.now, deps.sleep, REQUEST_GAP_MS);
    return load();
  });
}

/** users/me firmado. Un 200 de invitado no es una sesión válida. No escribe el estado. */
export async function fetchSignedUsersMe(state: StorageStateFile, deps: {
  fetch: typeof fetch;
  now: () => number;
}): Promise<{ status: number | null; guest: boolean }> {
  const auth = sessionForApi(state, deps.now());
  if ("reason" in auth) return { status: null, guest: false };
  const rules = await loadSignRules(deps.fetch, deps.now());
  const page = await getJson(deps.fetch, "/api2/v2/users/me", signedHeaders(rules, "/api2/v2/users/me", auth, deps.now()), deps.now());
  if (page.status === 401) return { status: 401, guest: true };
  if (!page.ok) return { status: page.status, guest: false };
  return { status: page.status, guest: !usersMeKeepsSession(usersMeVerdict(page.body)) };
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
    if (folderMediaRoute(pathWithQuery)) {
      return { ok: false, body: null, reason: "OnlyFans respondió 400", status: 400, sessionRejected: false, signatureRejected: false, retryAfterMs: 0, rotatedCookies };
    }
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
  return { threads: [], messages: [], reason, sessionRejected: false, signatureRejected: false, retryAfterMs: 0, rotatedCookies: [], accepted: false };
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
