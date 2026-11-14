import { spendLogLine } from "../../../src/lib/row-spend.ts";

/** La lista de suscriptores activos se refresca cada 10 minutos. */
export const SUBSCRIBER_TTL_MS = 10 * 60_000;
/** Un id sin totalSumm no se vuelve a pedir antes de 10 minutos. */
export const SPEND_NULL_TTL_MS = 10 * 60_000;
/** Como mucho estos GET /users/{id} por pasada. */
export const USER_SPEND_CAP = 10;
const SUBSCRIBER_PAGE = 10;
const MAX_SUBSCRIBER_PAGES = 40;

export type SpendPage = {
  ok: boolean;
  status: number;
  body: unknown;
  retryAfterMs: number;
  sessionRejected: boolean;
};

export type SpendStop = { status: number; retryAfterMs: number; sessionRejected: boolean };

type SubEntry = { at: number; byId: Map<string, number> };

const subscribers = new Map<string, SubEntry>();
const userKnown = new Map<string, { at: number; cents: number }>();
const nullUntil = new Map<string, number>();

export function clearFanSpendCache(): void {
  subscribers.clear();
  userKnown.clear();
  nullUntil.clear();
}

export function subscriberSpendPath(offset: number): string {
  return `/api2/v2/subscriptions/subscribers?limit=${SUBSCRIBER_PAGE}&type=active&offset=${offset}`;
}

export function userSpendPath(id: string): string | null {
  if (!/^\d{1,20}$/.test(id)) return null;
  return `/api2/v2/users/${id}`;
}

/** Solo totalSumm. El desglose no se suma. */
export function totalSummCents(record: Record<string, unknown> | null): number | null {
  if (!record) return null;
  const nested = asRecord(record.subscribedOnData) ?? asRecord(record.subscribedByData);
  const source = nested ?? record;
  return money(source.totalSumm ?? source.spent ?? source.totalSpent);
}

export function subscriberRows(body: unknown): Array<{ id: string; spentCents: number | null }> | null {
  const list = Array.isArray(body) ? body : asRecord(body)?.list;
  if (!Array.isArray(list)) return null;
  const rows: Array<{ id: string; spentCents: number | null }> = [];
  for (const item of list) {
    const record = asRecord(item);
    if (!record) continue;
    const id = textId(record.id);
    if (!id) continue;
    rows.push({ id, spentCents: totalSummCents(record) });
  }
  return rows;
}

export function userSpendCents(body: unknown): number | null {
  return totalSummCents(asRecord(body));
}

/**
 * Suscriptores activos (con caché) y, como mucho 10, GET /users/{id}
 * de los hilos visibles que siguen sin total. No marca leído.
 */
export async function collectFanSpend(input: {
  accountId: string;
  creatorId: string;
  threads: ReadonlyArray<{ fanKey: string | null; spentCents: number | null }>;
  visibleIds: readonly string[];
  cardIds?: ReadonlySet<string>;
  request: (path: string) => Promise<SpendPage>;
  now: number;
  log?: (line: string) => void;
}): Promise<{ byFan: Map<string, number>; stopped: SpendStop | null }> {
  const byFan = new Map<string, number>();
  let threadCount = 0;
  for (const thread of input.threads) {
    if (thread.spentCents == null || !thread.fanKey) continue;
    threadCount += 1;
    byFan.set(thread.fanKey, thread.spentCents);
  }
  const stopped = await refreshSubscribers(input);
  const subs = subscribers.get(input.accountId)?.byId ?? new Map<string, number>();
  let subscriberCount = 0;
  for (const thread of input.threads) {
    const id = thread.fanKey;
    if (!id || thread.spentCents != null || byFan.has(id)) continue;
    const cents = subs.get(id);
    if (cents == null) continue;
    byFan.set(id, cents);
    subscriberCount += 1;
  }
  for (const id of input.visibleIds) {
    if (byFan.has(id)) continue;
    const cents = subs.get(id);
    if (cents == null) continue;
    byFan.set(id, cents);
    subscriberCount += 1;
  }
  let userCount = 0;
  for (const id of input.visibleIds) {
    if (byFan.has(id)) continue;
    const hit = userKnown.get(cacheKey(input.accountId, id));
    if (!hit || input.now - hit.at >= SUBSCRIBER_TTL_MS) continue;
    byFan.set(id, hit.cents);
    userCount += 1;
  }
  if (!stopped) {
    for (const id of visibleMissing(input, byFan)) {
      const path = userSpendPath(id);
      if (!path) continue;
      const page = await input.request(path);
      if (!page.ok) {
        return logged(input, byFan, threadCount, subscriberCount, userCount, {
          status: page.status,
          retryAfterMs: page.retryAfterMs,
          sessionRejected: page.sessionRejected,
        });
      }
      const cents = userSpendCents(page.body);
      const key = cacheKey(input.accountId, id);
      if (cents == null) {
        nullUntil.set(key, input.now + SPEND_NULL_TTL_MS);
        continue;
      }
      userKnown.set(key, { at: input.now, cents });
      nullUntil.delete(key);
      byFan.set(id, cents);
      userCount += 1;
    }
  }
  return logged(input, byFan, threadCount, subscriberCount, userCount, stopped);
}

function logged(
  input: {
    accountId: string;
    creatorId: string;
    threads: ReadonlyArray<{ fanKey: string | null; spentCents: number | null }>;
    visibleIds: readonly string[];
    cardIds?: ReadonlySet<string>;
    log?: (line: string) => void;
  },
  byFan: Map<string, number>,
  threadCount: number,
  subscriberCount: number,
  userCount: number,
  stopped: SpendStop | null,
): { byFan: Map<string, number>; stopped: SpendStop | null } {
  const subs = subscribers.get(input.accountId)?.byId ?? new Map<string, number>();
  let cardCount = 0;
  if (input.cardIds) {
    for (const id of input.cardIds) {
      const onThread = input.threads.some((thread) => thread.fanKey === id && thread.spentCents != null);
      if (onThread || subs.has(id)) continue;
      cardCount += 1;
    }
  }
  const seen = new Set<string>();
  let stillNull = 0;
  const consider = (id: string | null) => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    if (byFan.has(id) || input.cardIds?.has(id)) return;
    stillNull += 1;
  };
  for (const thread of input.threads) consider(thread.fanKey);
  for (const id of input.visibleIds) consider(id);
  input.log?.(spendLogLine({
    creatorId: input.creatorId,
    thread: threadCount,
    card: cardCount,
    subscribers: subscriberCount,
    users: userCount,
    stillNull,
  }));
  return { byFan, stopped };
}

async function refreshSubscribers(input: {
  accountId: string;
  request: (path: string) => Promise<SpendPage>;
  now: number;
}): Promise<SpendStop | null> {
  const cached = subscribers.get(input.accountId);
  if (cached && input.now - cached.at < SUBSCRIBER_TTL_MS) return null;
  const byId = new Map<string, number>(cached?.byId);
  for (let page = 0; page < MAX_SUBSCRIBER_PAGES; page += 1) {
    const offset = page * SUBSCRIBER_PAGE;
    const read = await input.request(subscriberSpendPath(offset));
    if (!read.ok) {
      return { status: read.status, retryAfterMs: read.retryAfterMs, sessionRejected: read.sessionRejected };
    }
    const rows = subscriberRows(read.body);
    if (!rows || rows.length === 0) break;
    let withTotal = 0;
    for (const row of rows) {
      if (row.spentCents == null) continue;
      withTotal += 1;
      byId.set(row.id, row.spentCents);
    }
    if (withTotal === 0) break;
    const more = hasMore(read.body);
    if (more === false || rows.length < SUBSCRIBER_PAGE) break;
  }
  subscribers.set(input.accountId, { at: input.now, byId });
  return null;
}

function visibleMissing(input: {
  accountId: string;
  visibleIds: readonly string[];
  cardIds?: ReadonlySet<string>;
  now: number;
}, known: Map<string, number>): string[] {
  const out: string[] = [];
  for (const id of input.visibleIds) {
    if (out.length >= USER_SPEND_CAP) break;
    if (!/^\d{1,20}$/.test(id)) continue;
    if (known.has(id) || input.cardIds?.has(id)) continue;
    const key = cacheKey(input.accountId, id);
    const hit = userKnown.get(key);
    if (hit && input.now - hit.at < SUBSCRIBER_TTL_MS) {
      known.set(id, hit.cents);
      continue;
    }
    const until = nullUntil.get(key);
    if (until != null && until > input.now) continue;
    out.push(id);
  }
  return out;
}

function hasMore(body: unknown): boolean | null {
  const record = asRecord(body);
  if (!record || typeof record.hasMore !== "boolean") return null;
  return record.hasMore;
}

function cacheKey(accountId: string, fanId: string): string {
  return `${accountId}\0${fanId}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function textId(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(Math.trunc(value));
  if (typeof value === "string" && /^\d{1,20}$/.test(value)) return value;
  return null;
}

function money(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return Math.round(value * 100);
  if (typeof value === "string" && /^\d+(\.\d{1,2})?$/.test(value.trim())) return Math.round(Number(value.trim()) * 100);
  return null;
}
