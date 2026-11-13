import { formatCents } from "./format.ts";

export const SIN_DATOS = "Sin datos";

/** Primera página de la lista. El cliente web usa 10 (`Jg` en el bundle). */
export const NOTIFICATION_LIST_LIMIT = 10;
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

/** Mismo orden que el centro de notificaciones de OnlyFans. */
export const NOTIFICATION_TABS = [
  "all",
  "subscriptions",
  "purchases",
  "tips",
  "tags",
  "comments",
  "mentions",
  "likes",
  "promotions",
  "onlyfans",
] as const;
export type NotificationTab = (typeof NOTIFICATION_TABS)[number];

export const TAB_LABEL: Record<NotificationTab, string> = {
  all: "Todo",
  subscriptions: "Suscripciones",
  purchases: "Compras",
  tips: "Propinas",
  tags: "Etiquetas",
  comments: "Comentarios",
  mentions: "Menciones",
  likes: "Me gusta",
  promotions: "Promociones",
  onlyfans: "OnlyFans",
};

/** No leídas por pastilla. null: la clave no vino, y la pastilla dice Sin datos. */
export type NotificationCounts = Record<NotificationTab, number | null>;

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
  /** false cuando OnlyFans manda isRead true. null si el JSON no trae el campo. */
  ofUnread?: boolean | null;
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
    case "subscription":
    case "renewal":
      return "subscriptions";
    case "ppv":
      return "purchases";
    case "tip":
      return "tips";
    case "tag":
      return "tags";
    case "comment":
      return "comments";
    case "mention":
      return "mentions";
    case "like":
      return "likes";
    case "promotion":
    case "message":
      return "promotions";
    case "system":
    case "agency":
    case "other":
      return "onlyfans";
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

export const NOTIFICATION_TYPE_READS = [
  ["subscribed", "subscription"],
  ["purchases", "ppv"],
  ["tip", "tip"],
  ["tags", "tag"],
  ["commented", "comment"],
  ["mentioned", "mention"],
  ["favorited", "like"],
  ["promotions", "promotion"],
  ["onlyfans", "system"],
] as const;

const NOTIFICATION_TYPE_KIND = new Map<string, NotificationKind>(NOTIFICATION_TYPE_READS);

/** El tipo que OnlyFans pone en la URL de cada pestaña. */
/**
 * Tipo de `POST /users/notifications/read/{type}` según la ruta de la pastilla
 * en el bundle. Agencia, otros y etiquetas no tienen esa ruta.
 */
export function ofReadType(kind: NotificationKind): string | null {
  switch (kind) {
    case "subscription":
    case "renewal":
      return "subscribed";
    case "ppv":
      return "purchases";
    case "tip":
      return "tip";
    case "comment":
      return "commented";
    case "mention":
      return "mentioned";
    case "like":
      return "favorited";
    case "promotion":
    case "message":
      return "message";
    case "system":
      return "deactivated_media";
    case "tag":
    case "agency":
    case "other":
      return null;
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

/** El dueño puede marcar la cuenta entera. El chatter, solo los tipos que ve. */
export function visibleMarkScope(kinds: readonly NotificationKind[], role: "owner" | "member", everything: boolean): { all: boolean; types: string[] } {
  const visible = kinds.filter((kind) => role === "owner" || !isOwnerOnlyKind(kind));
  const types = [...new Set(visible.flatMap((kind) => {
    const type = ofReadType(kind);
    return type ? [type] : [];
  }))];
  return { all: role === "owner" && everything, types };
}

export function kindFromNotificationType(type: string | null): NotificationKind | null {
  if (!type) return null;
  const value = type.toLowerCase();
  if (["subscribed", "subscriptions", "subscription"].includes(value)) return "subscription";
  if (["purchases", "purchase", "ppv"].includes(value)) return "ppv";
  if (["tip", "tips"].includes(value)) return "tip";
  if (["tags", "tag"].includes(value)) return "tag";
  if (["commented", "comments", "comment"].includes(value)) return "comment";
  if (["mentioned", "mentions", "mention"].includes(value)) return "mention";
  if (["favorited", "likes", "like"].includes(value)) return "like";
  if (["promotions", "promotion"].includes(value)) return "promotion";
  if (["onlyfans", "system", "deactivated_media"].includes(value)) return "system";
  return NOTIFICATION_TYPE_KIND.get(value) ?? null;
}

export type ParseNotificationOptions = {
  /** auth_id de la cuenta. Esa persona no cuenta como fan. */
  accountUserId?: string | null;
};

export function parseNotificationPayload(value: unknown, options: ParseNotificationOptions = {}): ParsedNotification[] {
  const found: ParsedNotification[] = [];
  if (Array.isArray(value)) collectArray(value, found, true, options);
  else walk(value, found, 0, false, options);
  return dedupe(found);
}

/**
 * Contadores del `GET /users/notifications/count`.
 * Una clave que no viene es null, no 0. Etiquetas no salen de aquí:
 * son `newTagsCount` de `/users/me`. OnlyFans es `deactivated_media`
 * y, si también viene, `system`.
 */
export function parseNotificationCounts(value: unknown): NotificationCounts | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const media = countNumber(raw.deactivated_media);
  const system = countNumber(raw.system);
  const onlyfans = media == null && system == null ? null : (media ?? 0) + (system ?? 0);
  const counts: NotificationCounts = {
    all: countNumber(raw.all),
    subscriptions: countNumber(raw.subscribed),
    purchases: countNumber(raw.purchases),
    tips: countNumber(raw.tip),
    tags: null,
    comments: countNumber(raw.commented),
    mentions: countNumber(raw.mentioned),
    likes: countNumber(raw.favorited),
    promotions: countNumber(raw.message),
    onlyfans,
  };
  return Object.values(counts).some((item) => item != null) ? counts : null;
}

/** `newTagsCount` de GET /users/me. Si la clave no está, null. */
export function newTagsCountOf(value: unknown): number | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return countNumber((value as Record<string, unknown>).newTagsCount);
}

const CHATTER_COUNT_TABS = [
  "subscriptions",
  "purchases",
  "tips",
  "tags",
  "comments",
  "mentions",
  "likes",
  "promotions",
  "onlyfans",
] as const satisfies readonly NotificationTab[];

/**
 * Único sitio de la burbuja.
 * Con el marcado en OnlyFans encendido, el número es el de OnlyFans y baja
 * cuando la relectura del contador lo dice. Apagado, son las no leídas de
 * Fanlink: abrir el panel las marca aquí y el número baja. Un chatter no
 * suma agencia ni otros.
 */
export function notificationBellCount(input: {
  markOnOnlyfans: boolean;
  counts: NotificationCounts | null;
  rows: NotificationRecord[];
  role: "owner" | "member" | null;
}): { count: number | null; source: "onlyfans" | "fanlink" } {
  if (!input.markOnOnlyfans) {
    return { count: fanlinkUnread(input.rows, input.role), source: "fanlink" };
  }
  return { count: onlyfansUnread(input.counts, input.role), source: "onlyfans" };
}

function fanlinkUnread(rows: NotificationRecord[], role: "owner" | "member" | null): number {
  return rows.filter((row) => {
    if (role === "member" && isOwnerOnlyKind(row.kind)) return false;
    if (row.seenAt) return false;
    return row.ofUnread !== false;
  }).length;
}

function onlyfansUnread(counts: NotificationCounts | null, role: "owner" | "member" | null): number | null {
  if (!counts) return null;
  if (role === "member") {
    const present = CHATTER_COUNT_TABS.map((tab) => counts[tab]).filter((item): item is number => item != null);
    return present.length === 0 ? null : present.reduce((sum, item) => sum + item, 0);
  }
  return counts.all;
}

/**
 * Tiempo relativo con el reloj que se pasa. Días enteros, no un cubo de 24 h.
 * 25 horas es «hace 1 d», no «Reciente (24h)».
 */
export function relativeNotificationWhen(iso: string, now: Date): string {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return SIN_DATOS;
  const ms = now.getTime() - at;
  if (!Number.isFinite(ms) || ms < 0) return SIN_DATOS;
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "ahora";
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.floor(ms / 86_400_000);
  return `hace ${days} d`;
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

export function notificationLabels(row: NotificationRecord, role: "owner" | "member", now = new Date()): NotificationLabels | null {
  if (role !== "owner" && isOwnerOnlyKind(row.kind)) return null;
  const money = isFanSpendKind(row.kind) || row.kind === "agency";
  const amount = !money ? null : row.amountCents == null ? SIN_DATOS : formatCents(row.amountCents);
  return {
    title: row.pending ? `${kindLabel(row.kind)} · pendiente` : kindLabel(row.kind),
    body: row.body?.trim() ? row.body.trim() : SIN_DATOS,
    when: row.occurredAt ? relativeNotificationWhen(row.occurredAt, now) : SIN_DATOS,
    amount,
    pending: row.pending,
    destination: row.threadKey ? "thread" : row.fanKey ? "fan" : "none",
  };
}

function walk(value: unknown, found: ParsedNotification[], depth: number, bucket: boolean, options: ParseNotificationOptions): void {
  if (depth > 6 || !value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    collectArray(value, found, bucket, options);
    return;
  }
  const record = value as Record<string, unknown>;
  if (bucket) {
    const row = notificationFrom(record, options);
    if (row) found.push(row);
  }
  for (const [key, child] of Object.entries(record)) {
    if (!child || typeof child !== "object") continue;
    walk(child, found, depth + 1, LIST_KEYS.has(key.toLowerCase()), options);
  }
}

function collectArray(value: unknown[], found: ParsedNotification[], bucket: boolean, options: ParseNotificationOptions): void {
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    if (Array.isArray(item)) {
      collectArray(item, found, bucket, options);
      continue;
    }
    if (bucket) {
      const row = notificationFrom(item as Record<string, unknown>, options);
      if (row) found.push(row);
    }
    walk(item, found, 1, false, options);
  }
}

function notificationFrom(record: Record<string, unknown>, options: ParseNotificationOptions): ParsedNotification | null {
  const rawType = firstString(record, ["type", "subType", "notificationType", "action"]);
  if (!rawType) return null;
  const occurredAt = firstTime(record, ["createdAt", "created_at", "date", "publishedAt", "postedAt"]);
  const body = notificationText(record);
  const placed = placeNotification(record, rawType, body, options.accountUserId ?? null);
  const threadKey = firstString(record, ["chatId", "threadId", "threadKey", "relatedChatId"]) ?? threadFromLink(record);
  const key = notificationKey({
    id: firstString(record, ["id", "notificationId", "guid"]),
    kind: placed.kind,
    rawType,
    occurredAt,
    fanKey: placed.fanKey,
    threadKey,
    body,
  });
  if (!key) return null;
  const pending = placed.kind === "tag" && isPending(record, body);
  return {
    key,
    kind: placed.kind,
    body,
    fanKey: placed.fanKey,
    fanName: placed.fanName,
    threadKey,
    amountCents: amountOf(record),
    occurredAt,
    pending,
    ofUnread: unreadFlag(record),
  };
}

/**
 * La creadora no es una fan suya. «Tu suscripción a X ha caducado» y una
 * promoción de otra creadora se quedan en Promociones u OnlyFans.
 */
function placeNotification(
  record: Record<string, unknown>,
  rawType: string,
  body: string | null,
  accountUserId: string | null,
): { kind: NotificationKind; fanKey: string | null; fanName: string | null } {
  let kind = kindOf(rawType);
  const fan = fanOf(record);
  const self = accountUserId != null && fan.fanKey === accountUserId;
  const ownSub = isOwnSubscription(body) || followsOtherCreator(record, kind);
  if (kind === "promotion" || kind === "system" || ownSub || self) {
    const parked = kind === "system" ? "system" : ownSub || kind === "promotion" ? "promotion" : kind;
    return { kind: parked, fanKey: null, fanName: null };
  }
  return { kind, fanKey: fan.fanKey, fanName: fan.fanName };
}

function isOwnSubscription(body: string | null): boolean {
  return /tu suscripci[oó]n|your subscription/i.test(body ?? "");
}

function followsOtherCreator(record: Record<string, unknown>, kind: NotificationKind): boolean {
  if (kind !== "subscription" && kind !== "renewal") return false;
  const user = nested(record, ["user", "fromUser", "relatedUser", "subscriber"]);
  if (!user) return false;
  return user.subscribedBy === true && user.subscribedOn !== true;
}

function kindOf(raw: string): NotificationKind {
  const value = raw.toLowerCase().replace(/[\s-]+/g, "_");
  if (["like", "liked", "likes", "favorite", "favourite", "favorited"].includes(value)) return "like";
  if (["comment", "commented", "comments", "reply"].includes(value)) return "comment";
  if (["mention", "mentioned", "mentions"].includes(value)) return "mention";
  if (["tag", "tags", "tagged", "label", "labels"].includes(value)) return "tag";
  if (["subscribe", "subscribed", "subscription", "subscriptions", "new_subscriber", "subscriber", "expired", "expire", "unsubscribed"].includes(value)) return "subscription";
  if (["renewal", "rebill", "recurring", "renewed"].includes(value)) return "renewal";
  if (["tip", "tips"].includes(value)) return "tip";
  if (["ppv", "purchase", "purchases", "paided_message", "paided_post", "paid_message", "unlock", "message_purchase"].includes(value)) return "ppv";
  if (["promotion", "promo", "promotional", "discount", "campaign", "message"].includes(value)) return "promotion";
  if (["chat", "new_message"].includes(value)) return "message";
  if (["system", "announcement", "warning", "notice", "deactivated_media"].includes(value)) return "system";
  if (["payout", "payouts", "earning", "earnings", "balance", "balances", "gross", "revenue", "statement", "withdrawal"].includes(value)) return "agency";
  return "other";
}

function notificationText(record: Record<string, unknown>): string | null {
  const raw = firstString(record, ["text", "message", "body", "content", "excerpt"]);
  if (!raw) return null;
  let text = raw;
  const pairs = record.replacePairs;
  if (pairs && typeof pairs === "object" && !Array.isArray(pairs)) {
    for (const [key, value] of Object.entries(pairs as Record<string, unknown>)) {
      if (typeof value === "string") text = text.split(key).join(value.replace(/<[^>]+>/g, ""));
    }
  }
  const clean = text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return clean || null;
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
  const fanName = (user ? firstString(user, ["name", "displayName"]) : null)
    ?? firstString(record, ["name", "fanName"])
    ?? (user ? firstString(user, ["username"]) : null)
    ?? firstString(record, ["username"]);
  return { fanKey, fanName };
}

function unreadFlag(record: Record<string, unknown>): boolean | null {
  if (record.isRead === true) return false;
  if (record.isRead === false) return true;
  return null;
}

function threadFromLink(record: Record<string, unknown>): string | null {
  const pairs = record.replacePairs;
  if (!pairs || typeof pairs !== "object" || Array.isArray(pairs)) return null;
  const link = (pairs as Record<string, unknown>)["{MESSAGE_LINK}"];
  if (typeof link !== "string") return null;
  const match = /\/chats\/chat\/(\d+)/.exec(link);
  return match?.[1] ?? null;
}

function amountOf(record: Record<string, unknown>): number | null {
  const cents = firstNumber(record, ["amountCents", "priceCents", "tipCents"]);
  if (cents != null) return Math.round(cents);
  const dollars = firstNumber(record, ["amount", "price", "tip", "gross"]);
  if (dollars != null) return Math.round(dollars * 100);
  return amountFromPairs(record);
}

function amountFromPairs(record: Record<string, unknown>): number | null {
  const pairs = record.replacePairs;
  if (!pairs || typeof pairs !== "object" || Array.isArray(pairs)) return null;
  const bag = pairs as Record<string, unknown>;
  for (const key of ["{AMOUNT}", "{PRICE}"]) {
    const raw = bag[key];
    if (typeof raw !== "string") continue;
    const match = /([0-9]+(?:[.,][0-9]{1,2})?)/.exec(raw.replace(/,/g, ""));
    if (!match?.[1]) continue;
    const value = Number(match[1].replace(",", "."));
    if (Number.isFinite(value) && value >= 0) return Math.round(value * 100);
  }
  return null;
}

function countNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return Math.floor(value);
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return Number(value);
  return null;
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
    ofUnread: incoming.ofUnread ?? previous.ofUnread ?? null,
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
