import type { StorageStateFile } from "../sessions/storage-state.ts";
import { fetchSignedVault, VAULT_MEDIA_LIMIT } from "./of-chat-api.ts";
import type { ReadSql } from "./store.ts";
import { folderMediaCap, mergeVaultList, parseVaultBundle, vaultAllList, vaultFolderMark, vaultKeyNames, vaultPayloadKind, type VaultFile, type VaultList } from "./vault-model.ts";
import { finishListMembers, persistVaultRead, storedFolderCounts } from "./vault-store.ts";

/** Pausa entre páginas. Más lenta que el chat: la bóveda pesa. */
export const VAULT_PAGE_GAP_MS = 800;
/** Páginas de una sola lista. 40 × 40 cubre una bóveda de más de mil medios. */
export const VAULT_WALK_CAP = 40;
/** Páginas en total. La lista «all» tiene que poder terminar antes de las carpetas. */
export const VAULT_WALK_BUDGET = 200;
export const VAULT_WALK_CACHE_MS = 10 * 60 * 1000;

export type VaultWalk = {
  items: VaultFile[];
  thumbItems: VaultFile[];
  reason: string | null;
  hasMore: boolean;
  nextOffset: number;
  cached: boolean;
  status: number | null;
  sessionRejected: boolean;
  signatureRejected: boolean;
  retryAfterMs: number;
};

type CacheMark = {
  at: number;
  complete: boolean;
  items: VaultFile[];
  thumbItems: VaultFile[];
};

type WalkInput = {
  creatorId: string;
  state: StorageStateFile;
  fetch: typeof fetch;
  now: () => number;
  sql: ReadSql;
  sleep?: (ms: number) => Promise<void>;
  /** Cola de la cuenta. Sin esto la bóveda no espera al chat. */
  accountId?: string;
};

const cache = new Map<string, CacheMark>();
const inflight = new Map<string, Promise<VaultWalk>>();

export function clearVaultWalkCache(): void {
  cache.clear();
  inflight.clear();
}

export async function walkVault(input: WalkInput & { listId?: string; offset?: number; singlePage?: boolean }): Promise<VaultWalk> {
  const listId = input.listId?.trim().slice(0, 80) || "all";
  const offset = normalize(input.offset ?? 0);
  const flight = `${input.creatorId}\n${listId}\n${offset}`;
  const pending = inflight.get(flight);
  if (pending) return pending;
  const run = runWalk(input, listId, offset, input.singlePage === true).finally(() => {
    inflight.delete(flight);
  });
  inflight.set(flight, run);
  return run;
}

async function runWalk(input: WalkInput, listId: string, offset: number, singlePage = false): Promise<VaultWalk> {
  if (offset === 0) {
    const hit = fresh(input.creatorId, listId, input.now());
    if (hit) {
      console.info(`[fanlink:vault] cache lista=${vaultFolderMark(listId)} medios=${hit.items.length}`);
      return done(hit.items, hit.thumbItems, false, 0, true, null);
    }
  }
  const budget = { left: VAULT_WALK_BUDGET };
  const main = await walkOne(input, listId, offset, offset === 0, budget, false, null, singlePage);
  if (listId !== "all" || offset !== 0 || main.sessionRejected || main.signatureRejected) {
    if (offset === 0 && main.items.length > 0 && !main.hasMore && !main.sessionRejected && !main.signatureRejected && main.retryAfterMs === 0) {
      remember(input.creatorId, listId, input.now(), main.items, main.thumbItems);
    }
    return publicWalk(main);
  }
  let payloads = main.payloads;
  const extraLists = await walkListPages(input, payloads, budget);
  payloads = payloads.concat(extraLists);
  if (main.items.length > 0 || listsOf(payloads).length > 0) {
    for (const folder of listsOf(payloads)) {
      if (budget.left <= 0) {
        console.info(`[fanlink:vault] corte presupuesto listas=${listsOf(payloads).length}`);
        main.hasMore = true;
        break;
      }
      const cachedFolder = fresh(input.creatorId, folder.id, input.now());
      if (cachedFolder && cachedFolder.items.length > 0) {
        console.info(`[fanlink:vault] cache lista=${vaultFolderMark(folder.id)} medios=guardada`);
        continue;
      }
      logList(folder);
      if (folder.hasMedia === false && folder.type !== "custom") continue;
      const child = await walkOne(input, folder.id, 0, false, budget, true, folder.name);
      if (child.sessionRejected || child.signatureRejected || child.retryAfterMs > 0 || child.hasMore) {
        main.hasMore = true;
        break;
      }
    }
  }
  if (!main.hasMore && main.retryAfterMs === 0 && !main.sessionRejected && !main.signatureRejected) {
    remember(input.creatorId, listId, input.now(), main.items, main.thumbItems);
  }
  return publicWalk(main);
}

type PageWalk = VaultWalk & { payloads: unknown[] };

async function walkOne(
  input: WalkInput,
  listId: string,
  start: number,
  includeLists: boolean,
  budget: { left: number },
  store: boolean,
  listName: string | null = null,
  singlePage = false,
): Promise<PageWalk> {
  let offset = start;
  let pages = 0;
  const seen = new Set<string>();
  const items: VaultFile[] = [];
  let thumbItems: VaultFile[] = [];
  const payloads: unknown[] = [];
  let hasMore = false;
  let nextOffset = start;
  let status: number | null = null;
  let reason: string | null = null;
  let sessionRejected = false;
  let signatureRejected = false;
  let retryAfterMs = 0;
  const cap = listId === "all" ? null : folderMediaCap(await storedFolderCounts(input.sql, input.creatorId, listId));
  let suspicious = false;
  while (pages < VAULT_WALK_CAP) {
    if (budget.left <= 0) {
      hasMore = true;
      nextOffset = offset;
      console.info(`[fanlink:vault] corte presupuesto lista=${vaultFolderMark(listId)} offset=${offset}`);
      break;
    }
    budget.left -= 1;
    const read = await fetchSignedVault(input.state, vaultDeps(input), listId, offset, {
      includeLists: includeLists && pages === 0,
      includeMedia: true,
    });
    status = read.status;
    reason = read.reason;
    sessionRejected = read.sessionRejected;
    signatureRejected = read.signatureRejected;
    retryAfterMs = read.retryAfterMs;
    if (read.sessionRejected || read.signatureRejected || read.retryAfterMs > 0 || (read.payloads.length === 0 && read.reason)) {
      if (items.length === 0) break;
      hasMore = true;
      nextOffset = offset;
      console.info(`[fanlink:vault] corte lista=${vaultFolderMark(listId)} offset=${offset} status=${read.status ?? "sin"}`);
      break;
    }
    const peeked = mediaBody(read.payloads);
    const peekedCount = mediaCount(peeked);
    if (listId !== "all" && cap != null && items.length + peekedCount > cap) {
      suspicious = true;
      console.info(`[fanlink:vault] carpeta=${vaultFolderMark(listId)} sospechosa param=list_id n=${peekedCount} tope=${cap}`);
      hasMore = false;
      nextOffset = offset;
      break;
    }
    payloads.push(...read.payloads);
    for (const payload of read.payloads) logPayload(payload);
    const saved = await persistVaultRead(input.sql, input.creatorId, read.payloads, { listId, offset, listName });
    if (thumbItems.length === 0) thumbItems = saved;
    let freshCount = 0;
    for (const item of saved) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      items.push(item);
      freshCount += 1;
    }
    const body = mediaBody(read.payloads);
    const count = mediaCount(body);
    const flagged = explicitHasMore(body);
    const pageFull = count === VAULT_MEDIA_LIMIT;
    hasMore = flagged || pageFull;
    pages += 1;
    if (pageFull && !singlePage) {
      console.info(`[fanlink:vault] sin hasMore lista=${vaultFolderMark(listId)} offset=${offset} medios=${count} sigue=pagina-llena`);
    }
    if (!hasMore) {
      nextOffset = offset;
      break;
    }
    const next = followingOffset(body, offset, count);
    if (next <= offset || freshCount === 0) {
      console.info(`[fanlink:vault] lista no avanza lista=${vaultFolderMark(listId)} offset=${offset}`);
      hasMore = false;
      nextOffset = offset;
      break;
    }
    offset = next;
    nextOffset = next;
    if (singlePage) break;
    if (input.sleep) await input.sleep(VAULT_PAGE_GAP_MS);
  }
  if (hasMore && pages >= VAULT_WALK_CAP) {
    console.info(`[fanlink:vault] corte tope lista=${vaultFolderMark(listId)} offset=${nextOffset}`);
  }
  if (store && start === 0 && items.length > 0 && !hasMore && !sessionRejected && !signatureRejected && retryAfterMs === 0) {
    remember(input.creatorId, listId, input.now(), items, thumbItems);
  }
  if (listId !== "all" && start === 0 && !hasMore && !suspicious && !sessionRejected && !signatureRejected) {
    await finishListMembers(input.sql, input.creatorId, listId, items.map((item) => item.id));
  }
  console.info(`[fanlink:vault] fin lista=${vaultFolderMark(listId)} paginas=${pages} medios=${items.length} hasMore=${hasMore ? "si" : "no"}`);
  console.info(`[fanlink:vault] carpeta=${vaultFolderMark(listId)} n=${items.length}`);
  return {
    items,
    thumbItems,
    payloads,
    reason: items.length > 0 ? null : reason,
    hasMore,
    nextOffset,
    cached: false,
    status,
    sessionRejected,
    signatureRejected,
    retryAfterMs,
  };
}

async function walkListPages(input: WalkInput, payloads: readonly unknown[], budget: { left: number }): Promise<unknown[]> {
  const extra: unknown[] = [];
  let body = listsBody(payloads);
  let offset = 0;
  while (explicitHasMore(body)) {
    if (budget.left <= 0) {
      console.info(`[fanlink:vault] corte presupuesto listas offset=${offset}`);
      break;
    }
    const next = followingOffset(body, offset, listCount(body) || 100);
    if (next <= offset) break;
    offset = next;
    budget.left -= 1;
    const read = await fetchSignedVault(input.state, vaultDeps(input), "all", 0, {
      includeLists: true,
      includeMedia: false,
      listOffset: offset,
    });
    if (read.sessionRejected || read.signatureRejected || read.retryAfterMs > 0 || !read.payloads.length) break;
    extra.push(...read.payloads);
    for (const payload of read.payloads) logPayload(payload);
    await persistVaultRead(input.sql, input.creatorId, read.payloads, { listId: "all", offset: 0 });
    body = listsBody(read.payloads);
    console.info(`[fanlink:vault] listas offset=${offset} n=${listCount(body)} hasMore=${explicitHasMore(body) ? "si" : "no"}`);
    if (input.sleep) await input.sleep(VAULT_PAGE_GAP_MS);
  }
  return extra;
}

function vaultDeps(input: WalkInput): { fetch: typeof fetch; now: () => number; accountId?: string; sleep?: (ms: number) => Promise<void> } {
  return { fetch: input.fetch, now: input.now, accountId: input.accountId, sleep: input.sleep };
}

function publicWalk(walk: PageWalk): VaultWalk {
  return {
    items: walk.items,
    thumbItems: walk.thumbItems,
    reason: walk.reason,
    hasMore: walk.hasMore,
    nextOffset: walk.nextOffset,
    cached: false,
    status: walk.status,
    sessionRejected: walk.sessionRejected,
    signatureRejected: walk.signatureRejected,
    retryAfterMs: walk.retryAfterMs,
  };
}

function fresh(creatorId: string, listId: string, now: number): CacheMark | null {
  const mark = cache.get(`${creatorId}\n${listId}`);
  if (!mark) return null;
  if (now - mark.at > VAULT_WALK_CACHE_MS) return null;
  return mark;
}

function remember(creatorId: string, listId: string, now: number, items: VaultFile[], thumbItems: VaultFile[]): void {
  cache.set(`${creatorId}\n${listId}`, { at: now, complete: true, items, thumbItems });
}

function done(
  items: VaultFile[],
  thumbItems: VaultFile[],
  hasMore: boolean,
  nextOffset: number,
  cached: boolean,
  reason: string | null,
): VaultWalk {
  return {
    items,
    thumbItems,
    reason,
    hasMore,
    nextOffset,
    cached,
    status: 200,
    sessionRejected: false,
    signatureRejected: false,
    retryAfterMs: 0,
  };
}

function listsOf(payloads: readonly unknown[]): VaultList[] {
  const map = new Map<string, VaultList>();
  for (const payload of payloads) {
    for (const list of parseVaultBundle(payload).lists) {
      if (!list.id || list.id === "all") continue;
      const prev = map.get(list.id);
      map.set(list.id, prev ? richerList(prev, list) : list);
    }
  }
  return [...map.values()];
}

function richerList(prev: VaultList, next: VaultList): VaultList {
  return mergeVaultList(prev, next);
}

function logList(list: VaultList): void {
  console.info(`[fanlink:vault] carpeta=${vaultFolderMark(list.id)} fotos=${num(list.photos)} videos=${num(list.videos)} gifs=${num(list.gifs)} audios=${num(list.audios)} claves=${safe(list.sourceKeys ?? "ninguna")}`);
}

function logPayload(payload: unknown): void {
  const kind = vaultPayloadKind(payload);
  if (kind === "other" || !payload || typeof payload !== "object" || Array.isArray(payload)) return;
  const row = payload as Record<string, unknown>;
  const list = Array.isArray(row.list) ? row.list : Array.isArray(row.lists) ? row.lists : [];
  const first = list.find((item) => item && typeof item === "object" && !Array.isArray(item));
  const route = kind === "lists" ? "lists" : "media";
  const itemKeys = first ? vaultKeyNames(first) : "ausente";
  console.info(`[fanlink:vault] respuesta ruta=${route} claves=${safe(vaultKeyNames(row))} n=${list.length} hasMore=${hasMoreLabel(row)} itemClaves=${safe(itemKeys)}`);
  const all = kind === "lists" ? vaultAllList(payload) : null;
  if (all) logList(all);
}

function mediaBody(payloads: readonly unknown[]): unknown {
  for (let index = payloads.length - 1; index >= 0; index -= 1) {
    if (vaultPayloadKind(payloads[index]) === "media") return payloads[index];
  }
  return null;
}

function listsBody(payloads: readonly unknown[]): unknown {
  for (let index = payloads.length - 1; index >= 0; index -= 1) {
    if (vaultPayloadKind(payloads[index]) === "lists") return payloads[index];
  }
  return null;
}

function mediaCount(body: unknown): number {
  if (!body || typeof body !== "object") return 0;
  const list = (body as Record<string, unknown>).list;
  return Array.isArray(list) ? list.length : 0;
}

function listCount(body: unknown): number {
  if (!body || typeof body !== "object" || vaultPayloadKind(body) !== "lists") return 0;
  const raw = body as Record<string, unknown>;
  if (Array.isArray(raw.list)) return raw.list.length;
  if (Array.isArray(raw.lists)) return raw.lists.length;
  if (Array.isArray(raw.folders)) return raw.folders.length;
  return 0;
}

function explicitHasMore(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const raw = body as Record<string, unknown>;
  return raw.hasMore === true || raw.has_more === true;
}

function hasMoreField(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const raw = body as Record<string, unknown>;
  return "hasMore" in raw || "has_more" in raw;
}

function hasMoreLabel(body: unknown): string {
  if (!hasMoreField(body)) return "ausente";
  return explicitHasMore(body) ? "si" : "no";
}

export const VAULT_OFFSET_CAP = 2_000;

/** El tope no se traga una bóveda grande en silencio. */
export function boundVaultOffset(next: number, from: number, log: (line: string) => void = console.info): number {
  if (!Number.isFinite(next)) return from;
  const raw = Math.floor(next);
  if (raw > VAULT_OFFSET_CAP) {
    log(`[fanlink:vault] corte offset tope=${VAULT_OFFSET_CAP} pedido=${raw} desde=${from}`);
    return VAULT_OFFSET_CAP;
  }
  return Math.max(0, raw);
}

function followingOffset(body: unknown, offset: number, count: number): number {
  if (body && typeof body === "object") {
    const raw = body as Record<string, unknown>;
    const cursor = raw.nextOffset ?? raw.next_offset;
    if (typeof cursor === "number" && Number.isFinite(cursor) && cursor > offset) return boundVaultOffset(cursor, offset);
  }
  if (count > 0) return boundVaultOffset(offset + count, offset);
  return offset;
}

function normalize(offset: number): number {
  if (!Number.isFinite(offset) || offset <= 0) return 0;
  return boundVaultOffset(offset, 0);
}

function num(value: number | null | undefined): string {
  return value == null ? "sin" : String(value);
}

function safe(value: string): string {
  return value.replace(/https?:\/\/\S+/gi, "").replace(/[\r\n]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
}
