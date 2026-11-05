/**
 * Lectura de ingresos y fans a partir de JSON o del DOM.
 *
 * Fragilidad: no hay un contrato firmado. Se aceptan nombres de campo
 * habituales (date, subscriptions, tips, messages, posts, subscribedOnData,
 * totalSumm). Si OnlyFans los cambia, la sincronización queda vacía y la
 * razón dice «página cambiada» o «sin respuesta». No se copian otros campos.
 */

export type EarningKind = "total" | "subscription" | "tip" | "message" | "post";

export type EarningRow = {
  day: string;
  kind: EarningKind;
  amountCents: number;
  currency: string;
};

export type FanStatus = "active" | "expired";

export type FanRow = {
  fanKey: string;
  ofUserId: string | null;
  handle: string | null;
  displayName: string | null;
  subscribedAt: string | null;
  status: FanStatus;
  spentCents: number | null;
};

export type DomEarning = { day: string; kind: string; amount: string; currency: string };
export type DomFan = {
  id: string;
  handle: string;
  name: string;
  subscribed: string;
  status: string;
  spent: string;
};

const KIND_KEYS: Record<string, EarningKind> = {
  total: "total",
  net: "total",
  gross: "total",
  amount: "total",
  earnings: "total",
  subscription: "subscription",
  subscriptions: "subscription",
  subscribes: "subscription",
  subs: "subscription",
  tip: "tip",
  tips: "tip",
  message: "message",
  messages: "message",
  chat: "message",
  ppv: "message",
  chat_messages: "message",
  post: "post",
  posts: "post",
};

const DATE_KEYS = ["date", "day", "time", "period", "from", "timestamp"];
const LIST_KEYS = ["list", "earnings", "rows", "items", "data", "chart", "subscribers", "users"];
const SECRET = /password|token|cookie|secret|sess|authorization|csrf/i;

export function classifyJsonPath(url: string): "earnings" | "fans" | "other" {
  let path = "";
  try {
    path = new URL(url).pathname.toLowerCase();
  } catch {
    return "other";
  }
  if (/earnings|statements|payouts|\/stats/.test(path)) return "earnings";
  if (/subscribers|subscriptions|\/fans/.test(path)) return "fans";
  return "other";
}

export function parseEarningsJson(value: unknown, now = new Date()): EarningRow[] {
  const rows: EarningRow[] = [];
  walkEarnings(value, "USD", rows, 0);
  return dedupeEarnings(rows.filter((row) => dayOk(row.day, now)));
}

export function parseFansJson(value: unknown, now = new Date()): FanRow[] {
  const rows: FanRow[] = [];
  walkFans(value, rows, 0, now);
  return dedupeFans(rows).slice(0, 200);
}

export function parseEarningsDom(items: unknown, now = new Date()): EarningRow[] {
  if (!Array.isArray(items)) return [];
  const rows: EarningRow[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const day = dayOf(record.day);
    const kind = KIND_KEYS[String(record.kind ?? "").toLowerCase()];
    const amount = cents(record.amount);
    if (!day || !kind || amount == null || !dayOk(day, now)) continue;
    const currency = clean(record.currency, 8)?.toUpperCase() ?? "USD";
    rows.push({ day, kind, amountCents: amount, currency });
  }
  return dedupeEarnings(rows);
}

export function parseFansDom(items: unknown, now = new Date()): FanRow[] {
  if (!Array.isArray(items)) return [];
  const rows: FanRow[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const row = fanFrom({
      id: record.id,
      username: record.handle,
      name: record.name,
      subscribedAt: record.subscribed,
      status: record.status,
      spent: record.spent,
    }, now);
    if (row) rows.push(row);
  }
  return dedupeFans(rows).slice(0, 200);
}

export function readFailureReason(input: {
  redirected: boolean;
  wantEarnings: boolean;
  earningsUrl: boolean;
  earningsRows: boolean;
  fansUrl: boolean;
  fansRows: boolean;
  jsonPaths: string[];
}): string | null {
  if (input.redirected) return withPaths("redirigido a login", input.jsonPaths);
  const parts: string[] = [];
  if (input.wantEarnings && !input.earningsRows) {
    parts.push(input.earningsUrl ? "página cambiada (ingresos)" : "sin respuesta de ingresos");
  }
  if (!input.fansRows) {
    parts.push(input.fansUrl ? "página cambiada (fans)" : "sin respuesta de fans");
  }
  if (!parts.length) return null;
  return withPaths(parts.join(". "), input.jsonPaths);
}

export function chartEarnings(rows: EarningRow[]): Array<{ day: string; amountCents: number }> {
  const days = new Map<string, { parts: number; total: number }>();
  for (const row of rows) {
    const slot = days.get(row.day) ?? { parts: 0, total: 0 };
    if (row.kind === "total") slot.total += row.amountCents;
    else slot.parts += row.amountCents;
    days.set(row.day, slot);
  }
  return [...days.entries()]
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([day, slot]) => ({ day, amountCents: slot.parts > 0 ? slot.parts : slot.total }));
}

function walkEarnings(value: unknown, currency: string, rows: EarningRow[], depth: number): void {
  if (!value || typeof value !== "object" || depth > 4 || rows.length > 500) return;
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 120)) walkEarnings(item, currency, rows, depth + 1);
    return;
  }
  const record = value as Record<string, unknown>;
  const nextCurrency = clean(record.currency, 8)?.toUpperCase() ?? currency;
  pushEarningPoint(record, nextCurrency, rows);
  for (const [key, child] of Object.entries(record)) {
    if (SECRET.test(key) || !LIST_KEYS.includes(key)) continue;
    walkEarnings(child, nextCurrency, rows, depth + 1);
  }
}

function pushEarningPoint(record: Record<string, unknown>, currency: string, rows: EarningRow[]): void {
  const day = DATE_KEYS.map((key) => dayOf(record[key])).find((value) => value != null) ?? null;
  if (!day) return;
  let pushed = false;
  for (const [key, kind] of Object.entries(KIND_KEYS)) {
    if (!(key in record)) continue;
    const amount = cents(record[key]);
    if (amount == null) continue;
    rows.push({ day, kind, amountCents: amount, currency });
    pushed = true;
  }
  if (!pushed) return;
}

function walkFans(value: unknown, rows: FanRow[], depth: number, now: Date): void {
  if (!value || typeof value !== "object" || depth > 4 || rows.length > 200) return;
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 200)) {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        const row = fanFrom(item as Record<string, unknown>, now);
        if (row) rows.push(row);
      }
    }
    return;
  }
  const record = value as Record<string, unknown>;
  for (const [key, child] of Object.entries(record)) {
    if (SECRET.test(key)) continue;
    if (LIST_KEYS.includes(key) || key === "list") walkFans(child, rows, depth + 1, now);
  }
}

function fanFrom(record: Record<string, unknown>, now: Date): FanRow | null {
  const nested = nestedRecord(record.subscribedOnData) ?? nestedRecord(record.subscribedByData);
  const handle = clean(record.username, 80) ?? clean(record.handle, 80) ?? clean(nested?.username, 80);
  const displayName = clean(record.name, 80) ?? clean(record.displayName, 80);
  const ofUserId = numericId(record.id) ?? numericId(record.userId);
  if (!handle && !displayName && !ofUserId) return null;
  if (record.isAuth === true || record.isPerformer === true) return null;
  const subscribedAt =
    iso(record.subscribedAt) ??
    iso(record.subscribeAt) ??
    iso(nested?.subscribedAt) ??
    iso(nested?.subscribeAt) ??
    iso(nested?.startDate);
  const spent =
    cents(record.spent) ??
    cents(record.totalSumm) ??
    cents(record.totalSpent) ??
    cents(nested?.totalSumm) ??
    cents(nested?.spent);
  const status = fanStatus(record, nested, now);
  const fanKey = (ofUserId ?? handle ?? displayName ?? "").toLowerCase();
  if (!fanKey) return null;
  return {
    fanKey: fanKey.slice(0, 80),
    ofUserId,
    handle: handle ? handle.replace(/^@+/, "") : null,
    displayName,
    subscribedAt,
    status,
    spentCents: spent,
  };
}

function fanStatus(
  record: Record<string, unknown>,
  nested: Record<string, unknown> | null,
  now: Date,
): FanStatus {
  if (record.subscribedByExpire === true || record.subscribedOnExpiredNow === true || record.isExpired === true) {
    return "expired";
  }
  const label = String(record.status ?? nested?.status ?? "").toLowerCase();
  if (label === "expired" || label === "expirado" || label === "inactive") return "expired";
  const expire = dayOf(record.expiredAt) ?? dayOf(record.expireDate) ?? dayOf(nested?.expiredAt) ?? dayOf(nested?.expireDate);
  const today = now.toISOString().slice(0, 10);
  if (expire && expire < today) return "expired";
  return "active";
}

function dedupeEarnings(rows: EarningRow[]): EarningRow[] {
  const map = new Map<string, EarningRow>();
  for (const row of rows) {
    const key = `${row.day}:${row.kind}:${row.currency}`;
    const prev = map.get(key);
    if (!prev) map.set(key, { ...row });
    else prev.amountCents += row.amountCents;
  }
  return [...map.values()];
}

function dedupeFans(rows: FanRow[]): FanRow[] {
  const map = new Map<string, FanRow>();
  for (const row of rows) map.set(row.fanKey, row);
  return [...map.values()];
}

function nestedRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function cents(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return Math.round(value * 100);
  if (typeof value === "string" && /^\d+(\.\d{1,2})?$/.test(value.trim())) return Math.round(Number(value) * 100);
  return null;
}

function dayOf(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 1_000_000_000) {
    const millis = value > 10_000_000_000 ? value : value * 1000;
    const date = new Date(millis);
    if (Number.isNaN(date.getTime())) return null;
    return date.toISOString().slice(0, 10);
  }
  if (typeof value !== "string") return null;
  return value.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? null;
}

function dayOk(day: string, now: Date): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const year = Number(day.slice(0, 4));
  return year >= 2000 && year <= now.getUTCFullYear() + 1;
}

function iso(value: unknown): string | null {
  const day = dayOf(value);
  if (!day) return null;
  return `${day}T00:00:00.000Z`;
}

function numericId(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(Math.trunc(value));
  if (typeof value === "string" && /^\d{1,20}$/.test(value)) return value;
  return null;
}

function clean(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.slice(0, max);
}

function withPaths(reason: string, _paths: string[]): string {
  return reason.slice(0, 180);
}
