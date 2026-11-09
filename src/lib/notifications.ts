import { formatCents } from "./format.ts";

export const SIN_DATOS = "Sin datos";

/** Una pasada abre la página y, como mucho, un desplazamiento. */
export const NOTIFICATION_MAX_SCROLLS = 1;
/** Pausa antes de ese desplazamiento. No es el ritmo del chat. */
export const NOTIFICATION_PACE_MS = 8_000;
export const NOTIFICATION_INTERVAL_MIN = 30;
export const NOTIFICATION_PAGE_SIZE = 50;
export const NOTIFICATION_RETENTION_DAYS = 90;

export const NOTIFICATION_KINDS = [
  "like",
  "comment",
  "tag",
  "subscription",
  "renewal",
  "tip",
  "ppv",
  "message",
  "mention",
  "promotion",
  "system",
  "agency",
  "other",
] as const;

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export const NOTIFICATION_TABS = ["all", "interactions", "purchases", "subscriptions", "tags", "other"] as const;
export type NotificationTab = (typeof NOTIFICATION_TABS)[number];

export const TAB_LABEL: Record<NotificationTab, string> = {
  all: "All",
  interactions: "Interactions",
  purchases: "Purchases",
  subscriptions: "Subscriptions",
  tags: "Tags",
  other: "Other",
};

const KIND_LABEL: Record<NotificationKind, string> = {
  like: "Me gusta",
  comment: "Comentario",
  tag: "Etiqueta",
  subscription: "Suscripción",
  renewal: "Renovación",
  tip: "Propina",
  ppv: "Compra PPV",
  message: "Mensaje",
  mention: "Mención",
  promotion: "Promoción",
  system: "Aviso",
  agency: "Aviso de la agencia",
  other: "Otro",
};

const FAN_SPEND_KINDS = new Set<NotificationKind>(["subscription", "renewal", "tip", "ppv"]);
const OWNER_ONLY_KINDS = new Set<NotificationKind>(["agency", "other"]);

export type ParsedNotification = {
  key: string;
  kind: NotificationKind;
  body: string | null;
  fanKey: string | null;
  fanName: string | null;
  threadKey: string | null;
  amountCents: number | null;
  occurredAt: string | null;
  pending: boolean;
};

export type NotificationRecord = ParsedNotification & {
  creatorId: string;
  seenAt: string | null;
};

export type NotificationLabels = {
  title: string;
  body: string;
  when: string;
  amount: string | null;
  pending: boolean;
  destination: "fan" | "thread" | "none";
};

const LIST_KEYS = new Set(["notifications", "notification", "list", "items", "rows", "data"]);

/** Compra, propina o suscripción de un fan. El chatter de esa cuenta ve el importe. */
export function isFanSpendKind(kind: NotificationKind): boolean {
  return FAN_SPEND_KINDS.has(kind);
}

/** Ganancias de la agencia y tipos desconocidos. Solo la dueña. */
export function isOwnerOnlyKind(kind: NotificationKind): boolean {
  return OWNER_ONLY_KINDS.has(kind);
}

/** Lo que ya es solo de la dueña no pasa a un tipo que vea el chatter. Una propina tampoco se rebaja. */
export function mergeKind(previous: NotificationKind, incoming: NotificationKind): NotificationKind {
  if (isOwnerOnlyKind(previous) && !isOwnerOnlyKind(incoming)) return previous;
  if (isFanSpendKind(previous) && !isFanSpendKind(incoming)) return previous;
  return incoming;
}

export function chatterVisibleKinds(): NotificationKind[] {
  return NOTIFICATION_KINDS.filter((kind) => !isOwnerOnlyKind(kind));
}

export function tabOf(kind: NotificationKind): NotificationTab {
  switch (kind) {
    case "like":
    case "comment":
      return "interactions";
    case "tip":
    case "ppv":
      return "purchases";
    case "subscription":
    case "renewal":
      return "subscriptions";
    case "tag":
      return "tags";
    case "mention":
    case "message":
    case "promotion":
    case "system":
    case "agency":
    case "other":
      return "other";
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

export function isNotificationTab(value: string): value is NotificationTab {
  return (NOTIFICATION_TABS as readonly string[]).includes(value);
}

export function kindLabel(kind: NotificationKind): string {
  switch (kind) {
    case "like":
    case "comment":
    case "tag":
    case "subscription":
    case "renewal":
    case "tip":
    case "ppv":
    case "message":
    case "mention":
    case "promotion":
    case "system":
    case "agency":
    case "other":
      return KIND_LABEL[kind];
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

/** Otra cuenta leyendo no bloquea. Solo bloquea la misma cuenta. */
export function notificationReadBusy(readingIds: readonly string[], accountId: string): boolean {
  return readingIds.includes(accountId);
}

export function encodeNotificationCursor(cursor: { at: string | null; key: string }): string {
  return JSON.stringify({ at: cursor.at, key: cursor.key });
}

export function decodeNotificationCursor(value: string | null | undefined): { at: string | null; key: string } | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as { at?: unknown; key?: unknown };
    if (!parsed || typeof parsed.key !== "string" || !parsed.key) return null;
    const at = typeof parsed.at === "string" && parsed.at ? parsed.at : null;
    if (at && Number.isNaN(Date.parse(at))) return null;
    return { at, key: parsed.key };
  } catch {
    return null;
  }
}

/** Origen y ruta, sin query, usuario ni token. */
export function redactedNotificationUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.username || parsed.password) return null;
    const safe = `${parsed.origin}${parsed.pathname}`.slice(0, 200);
    if (!isNotificationResponseUrl(safe)) return null;
    if (/[?#]|token|sess|auth/i.test(safe)) return null;
    return safe;
  } catch {
    return null;
  }
}

/** Recorta y junta espacios. La clave sin id no usa el texto: un retoque no lo duplica. */
export function normalizeNotificationText(body: string | null | undefined): string {
  return (body ?? "").trim().replace(/\s+/g, " ");
}

/**
 * SHA-256 en hex. La campana importa este módulo en el navegador y no calcula
 * claves: un import estático de node:crypto tumbaría el panel. createHash se
 * pide solo cuando esto corre en Node.
 */
export function notificationSha256(value: string): string {
  const { createHash } = process.getBuiltinModule("node:crypto");
  return createHash("sha256").update(value).digest("hex");
}

export function notificationKey(input: {
  id: string | null;
  kind: NotificationKind;
  rawType: string;
  occurredAt: string | null;
  fanKey: string | null;
  threadKey: string | null;
  body?: string | null;
}): string | null {
  const full = input.id
    ? input.id
    : input.occurredAt
      ? [input.kind, input.rawType, input.occurredAt, input.fanKey ?? "", input.threadKey ?? ""].join("\u001f")
      : null;
  if (!full) return null;
  if (full.length <= 120) return full;
  // 113 caracteres y el separador en el 81. La 0036 no debe tratar esto como una clave antigua.
  return `${full.slice(0, 80)}\u001f${notificationSha256(full).slice(0, 32)}`;
}

/** La ruta que la propia página pide. No construye una llamada. */
export function isNotificationResponseUrl(url: string): boolean {
  try {
    const path = new URL(url).pathname.toLowerCase();
    if (!path.includes("/api2/") && !path.includes("/api/")) return false;
    return path.includes("notification");
  } catch {
    return false;
  }
}

export function notificationScrolls(requested: number): number {
  if (!Number.isFinite(requested) || requested <= 0) return 0;
  return Math.min(NOTIFICATION_MAX_SCROLLS, Math.floor(requested));
}

export function parseNotificationPayload(value: unknown): ParsedNotification[] {
  const found: ParsedNotification[] = [];
  if (Array.isArray(value)) collectArray(value, found, true);
  else walk(value, found, 0, false);
  return dedupe(found);
}

export function mergeNotifications(current: ParsedNotification[], incoming: ParsedNotification[]): ParsedNotification[] {
  const map = new Map(current.map((item) => [item.key, item]));
  for (const item of incoming) {
    const previous = map.get(item.key);
    map.set(item.key, previous ? fillGaps(previous, item) : item);
  }
  return [...map.values()];
}

/** Un chatter solo entra en las cuentas asignadas. La dueña, que es quien administra, entra en todas. */
export function canReadCreatorNotifications(
  access: { role: "owner" | "member"; creatorIds: string[] } | null,
  creatorId: string,
): boolean {
  if (!access || !creatorId) return false;
  if (access.role === "owner") return true;
  return access.creatorIds.includes(creatorId);
}

export function visibleNotifications(
  rows: NotificationRecord[],
  access: { role: "owner" | "member"; creatorIds: string[] } | null,
  creatorId: string,
): NotificationRecord[] {
  if (!canReadCreatorNotifications(access, creatorId) || !access) return [];
  return rows.filter((row) => {
    if (row.creatorId !== creatorId) return false;
    if (access.role !== "owner" && isOwnerOnlyKind(row.kind)) return false;
    return true;
  });
}

export type NotificationFilter = {
  rows: NotificationRecord[];
  undated: NotificationRecord[];
};

export function filterNotifications(
  rows: NotificationRecord[],
  query: { tab: NotificationTab; text: string; from: string; to: string },
): NotificationFilter {
  const needle = query.text.trim().toLowerCase();
  const from = dayOrNull(query.from);
  const to = dayOrNull(query.to);
  const ranged = Boolean(from || to);
  const matched = rows
    .filter((row) => query.tab === "all" || tabOf(row.kind) === query.tab)
    .filter((row) => !needle || haystack(row).includes(needle));
  const dated: NotificationRecord[] = [];
  const undated: NotificationRecord[] = [];
  for (const row of matched) {
    if (!row.occurredAt) {
      if (ranged) undated.push(row);
      else dated.push(row);
      continue;
    }
    if (!ranged || inDates(row.occurredAt, from, to)) dated.push(row);
  }
  dated.sort((left, right) => compareWhen(left.occurredAt, right.occurredAt));
  undated.sort((left, right) => compareWhen(left.occurredAt, right.occurredAt));
  return { rows: dated, undated };
}

export function unreadCount(rows: NotificationRecord[]): number {
  return rows.filter((row) => !row.seenAt).length;
}

export function notificationLabels(row: NotificationRecord, role: "owner" | "member"): NotificationLabels | null {
  if (role !== "owner" && isOwnerOnlyKind(row.kind)) return null;
  const money = isFanSpendKind(row.kind) || row.kind === "agency";
  const amount = !money ? null : row.amountCents == null ? SIN_DATOS : formatCents(row.amountCents);
  return {
    title: row.pending ? `${kindLabel(row.kind)} · pendiente` : kindLabel(row.kind),
    body: row.body?.trim() ? row.body.trim() : SIN_DATOS,
    when: row.occurredAt ? madridStamp(row.occurredAt) : SIN_DATOS,
    amount,
    pending: row.pending,
    destination: row.threadKey ? "thread" : row.fanKey ? "fan" : "none",
  };
}

function walk(value: unknown, found: ParsedNotification[], depth: number, bucket: boolean): void {
  if (depth > 6 || !value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    collectArray(value, found, bucket);
    return;
  }
  const record = value as Record<string, unknown>;
  if (bucket) {
    const row = notificationFrom(record);
    if (row) found.push(row);
  }
  for (const [key, child] of Object.entries(record)) {
    if (!child || typeof child !== "object") continue;
    walk(child, found, depth + 1, LIST_KEYS.has(key.toLowerCase()));
  }
}

function collectArray(value: unknown[], found: ParsedNotification[], bucket: boolean): void {
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    if (Array.isArray(item)) {
      collectArray(item, found, bucket);
      continue;
    }
    if (bucket) {
      const row = notificationFrom(item as Record<string, unknown>);
      if (row) found.push(row);
    }
    walk(item, found, 1, false);
  }
}

function notificationFrom(record: Record<string, unknown>): ParsedNotification | null {
  const rawType = firstString(record, ["type", "subType", "notificationType", "action"]);
  if (!rawType) return null;
  const kind = kindOf(rawType);
  const fan = fanOf(record);
  const occurredAt = firstTime(record, ["createdAt", "created_at", "date", "publishedAt", "postedAt"]);
  const body = firstString(record, ["text", "message", "body", "content", "excerpt"]);
  const threadKey = firstString(record, ["chatId", "threadId", "threadKey", "relatedChatId"]);
  const key = notificationKey({
    id: firstString(record, ["id", "notificationId", "guid"]),
    kind,
    rawType,
    occurredAt,
    fanKey: fan.fanKey,
    threadKey,
    body,
  });
  if (!key) return null;
  const pending = kind === "tag" && isPending(record, body);
  return {
    key,
    kind,
    body,
    fanKey: fan.fanKey,
    fanName: fan.fanName,
    threadKey,
    amountCents: amountOf(record),
    occurredAt,
    pending,
  };
}

function kindOf(raw: string): NotificationKind {
  const value = raw.toLowerCase().replace(/[\s-]+/g, "_");
  if (["like", "liked", "favorite", "favourite", "favorited"].includes(value)) return "like";
  if (["comment", "commented", "reply"].includes(value)) return "comment";
  if (["mention", "mentioned", "mentions"].includes(value)) return "mention";
  if (["tag", "tagged", "label", "labels"].includes(value)) return "tag";
  if (["subscribe", "subscribed", "subscription", "new_subscriber", "subscriber"].includes(value)) return "subscription";
  if (["renewal", "rebill", "recurring", "renewed"].includes(value)) return "renewal";
  if (["tip", "tips"].includes(value)) return "tip";
  if (["ppv", "purchase", "paided_message", "paid_message", "unlock", "message_purchase"].includes(value)) return "ppv";
  if (["promotion", "promo", "promotional", "discount", "campaign"].includes(value)) return "promotion";
  if (["message", "chat", "new_message"].includes(value)) return "message";
  if (["system", "announcement", "warning", "notice"].includes(value)) return "system";
  if (["payout", "payouts", "earning", "earnings", "balance", "balances", "gross", "revenue", "statement", "withdrawal"].includes(value)) return "agency";
  return "other";
}

function isPending(record: Record<string, unknown>, body: string | null): boolean {
  const status = firstString(record, ["status", "state"])?.toLowerCase() ?? "";
  if (record.isPending === true || record.pending === true || record.missing === true) return true;
  if (["pending", "missing", "failed", "faltante", "pendiente"].includes(status)) return true;
  return /pendiente|faltante|missing/i.test(body ?? "");
}

function fanOf(record: Record<string, unknown>): { fanKey: string | null; fanName: string | null } {
  const user = nested(record, ["user", "fromUser", "relatedUser", "subscriber"]);
  const fanKey = firstString(record, ["userId", "fanId", "fanKey"]) ?? (user ? firstString(user, ["id", "userId"]) : null);
  const fanName = firstString(record, ["username", "name", "fanName"]) ?? (user ? firstString(user, ["name", "username", "displayName"]) : null);
  return { fanKey, fanName };
}

function amountOf(record: Record<string, unknown>): number | null {
  const cents = firstNumber(record, ["amountCents", "priceCents", "tipCents"]);
  if (cents != null) return Math.round(cents);
  const dollars = firstNumber(record, ["amount", "price", "tip", "gross"]);
  if (dollars == null) return null;
  return Math.round(dollars * 100);
}

function fillGaps(previous: ParsedNotification, incoming: ParsedNotification): ParsedNotification {
  return {
    key: previous.key,
    kind: mergeKind(previous.kind, incoming.kind),
    body: incoming.body ?? previous.body,
    fanKey: incoming.fanKey ?? previous.fanKey,
    fanName: incoming.fanName ?? previous.fanName,
    threadKey: incoming.threadKey ?? previous.threadKey,
    amountCents: incoming.amountCents ?? previous.amountCents,
    occurredAt: incoming.occurredAt ?? previous.occurredAt,
    pending: previous.pending || incoming.pending,
  };
}

function dedupe(rows: ParsedNotification[]): ParsedNotification[] {
  const map = new Map<string, ParsedNotification>();
  for (const row of rows) map.set(row.key, fillGaps(map.get(row.key) ?? row, row));
  return [...map.values()];
}

function haystack(row: NotificationRecord): string {
  return [row.body, row.fanName, row.fanKey, kindLabel(row.kind)].filter(Boolean).join(" ").toLowerCase();
}

function inDates(occurredAt: string | null, from: string | null, to: string | null): boolean {
  if (!from && !to) return true;
  if (!occurredAt) return false;
  const day = madridDay(occurredAt);
  if (!day) return false;
  if (from && day < from) return false;
  if (to && day > to) return false;
  return true;
}

function compareWhen(left: string | null, right: string | null): number {
  if (left === right) return 0;
  if (!left) return 1;
  if (!right) return -1;
  return right.localeCompare(left);
}

function dayOrNull(value: string): string | null {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function madridDay(iso: string): string | null {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return null;
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(time));
}

function madridStamp(iso: string): string {
  const day = madridDay(iso);
  return day ?? SIN_DATOS;
}

function nested(record: Record<string, unknown>, keys: string[]): Record<string, unknown> | null {
  for (const key of keys) {
    const value = record[key];
    if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  }
  return null;
}

function firstString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return String(Math.trunc(value));
    if (typeof value === "string" && value.trim()) return value.trim().slice(0, 500);
  }
  return null;
}

function firstNumber(record: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
    if (typeof value === "string" && /^\d+(\.\d{1,2})?$/.test(value.trim())) return Number(value);
  }
  return null;
}

function firstTime(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value) && value > 1_000_000_000) {
      const millis = value > 10_000_000_000 ? value : value * 1000;
      const date = new Date(millis);
      if (!Number.isNaN(date.getTime())) return date.toISOString();
    }
    if (typeof value === "string" && value.trim()) {
      const parsed = Date.parse(value);
      if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();
    }
  }
  return null;
}
