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

/**
 * El `type` de GET /api2/v2/users/notifications, el de cada pestaña del centro.
 * Etiquetas no es un type de ese endpoint: su lista es GET /api2/v2/release-forms/mentions
 * (catálogo OF Manager, módulo 783434) y su contador es `newTagsCount` de /users/me.
 * Aquí entra como el pseudo-type `tags` para que la cola y la caché por pestaña lo traten igual.
 * Promociones es `message`. Una emisión en directo solo entra ahí si OnlyFans
 * la devuelve con ese type.
 */
export const OF_NOTIFICATION_LIST_TYPES = [
  "subscribed",
  "purchases",
  "tip",
  "tags",
  "commented",
  "mentioned",
  "favorited",
  "message",
  "deactivated_media",
] as const;
export type OfNotificationListType = (typeof OF_NOTIFICATION_LIST_TYPES)[number];

const OF_LIST_TAB: Record<OfNotificationListType, NotificationTab> = {
  subscribed: "subscriptions",
  purchases: "purchases",
  tip: "tips",
  tags: "tags",
  commented: "comments",
  mentioned: "mentions",
  favorited: "likes",
  message: "promotions",
  deactivated_media: "onlyfans",
};

export function ofTabForListType(type: OfNotificationListType): NotificationTab {
  return OF_LIST_TAB[type];
}

/** El type de la petición de esa pestaña. Todo no lleva type. Etiquetas tampoco. */
export function ofListType(tab: NotificationTab): OfNotificationListType | null {
  const found = (Object.entries(OF_LIST_TAB) as Array<[OfNotificationListType, NotificationTab]>).find(([, value]) => value === tab);
  return found?.[0] ?? null;
}

/** Pestaña del aviso: el type de OnlyFans manda. Sin type, vale el kind. */
export function noticeTab(row: { ofType?: string | null; kind?: NotificationKind | null }): NotificationTab | null {
  const type = row.ofType ?? null;
  if (type && Object.prototype.hasOwnProperty.call(OF_LIST_TAB, type)) return OF_LIST_TAB[type as OfNotificationListType];
  if (row.kind) return tabOf(row.kind);
  return null;
}

export function kindsForTab(tab: NotificationTab): NotificationKind[] {
  return NOTIFICATION_KINDS.filter((kind) => tabOf(kind) === tab);
}

/**
 * Todo enseña todos los avisos de la creadora, una vez por clave.
 * El resto, solo los de su type. Sin type, los de su kind. Ninguno en dos pestañas.
 */
export function noticesForOfTab<T extends { ofType?: string | null; kind?: NotificationKind | null; key?: string }>(rows: readonly T[], tab: NotificationTab): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of rows) {
    const id = row.key ?? "";
    if (id && seen.has(id)) continue;
    if (id) seen.add(id);
    if (tab !== "all" && noticeTab(row) !== tab) continue;
    out.push(row);
  }
  return out;
}

/**
 * El número de la pestaña es el de no leídas de OnlyFans. La lista es la página
 * de ese type, que puede incluir leídas.
 */
export function ofTabListNote(input: { tab: NotificationTab; unread: number | null; listed: number }): string | null {
  if (input.unread == null || input.unread <= 0) return null;
  if (input.listed === input.unread) return null;
  if (input.tab === "tags" && input.listed === 0) {
    return `${input.unread} no leídas. La lista de etiquetas de OnlyFans aún no ha traído ninguna.`;
  }
  return `${input.unread} no leídas. La lista es la página de OnlyFans para esta pestaña.`;
}

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
  fanHandle?: string | null;
  avatarUrl?: string | null;
  /** null si el JSON no trae listas. [] si las trae vacías. */
  lists?: string[] | null;
  /** null si no viene un booleano de renovación. */
  renewAuto?: boolean | null;
  /** lastSeen del fan, si el JSON lo trae. */
  fanSeenAt?: string | null;
  /** id de la publicación, solo si el JSON lo trae. */
  postRef?: string | null;
  postLink?: string | null;
  postText?: string | null;
  /** Type de la petición que trajo el aviso. Null o ausente si vino en Todo, sin type. */
  ofType?: string | null;
  /** Hilo y mensaje de OnlyFans, si el aviso de compra trae el enlace. `t:hilo/m:mensaje`. */
  messageRef?: string | null;
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

export function notesForCreator<T extends { creatorId: string }>(rows: readonly T[], creatorId: string | null): T[] {
  if (!creatorId || creatorId === "all") return [];
  return rows.filter((row) => row.creatorId === creatorId);
}

export function renewStatusLabel(value: boolean | null | undefined): string | null {
  if (value == null) return null;
  return value ? "Renew On" : "Renew Off";
}

/** El primer mensaje del equipo a ese fan, posterior al aviso, con el nombre del remitente. */
export function notificationReplyLine(input: {
  creatorId: string;
  fanKey: string | null;
  occurredAt: string | null;
  messages: readonly {
    creatorId: string;
    fanKey: string | null;
    fromFan: boolean;
    sentAt: string;
    authorName: string | null;
    automatic?: boolean | null;
  }[];
}): string | null {
  if (!input.creatorId || input.creatorId === "all" || !input.fanKey || !input.occurredAt) return null;
  const noticeAt = Date.parse(input.occurredAt);
  if (Number.isNaN(noticeAt)) return null;
  const replies = input.messages.filter((message) => {
    if (message.creatorId !== input.creatorId || message.fanKey !== input.fanKey) return false;
    if (message.fromFan || message.automatic) return false;
    const name = message.authorName?.trim();
    if (!name) return false;
    const sentAt = Date.parse(message.sentAt);
    return !Number.isNaN(sentAt) && sentAt > noticeAt;
  }).sort((left, right) => left.sentAt.localeCompare(right.sentAt));
  const author = replies[0]?.authorName?.trim();
  return author ? `${author} respondió a la notificación` : null;
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

const CHAT_KINDS: ReadonlySet<NotificationKind> = new Set(["like", "ppv", "tip", "subscription", "renewal"]);

/**
 * Solo los avisos de un fan que gasta o reacciona (me gusta, compra de PPV, propina,
 * suscripción o renovación) llevan a su conversación. Etiquetas, promociones, comentarios,
 * menciones, OnlyFans y el resto solo se ven.
 */
export function notificationOpensChat(kind: NotificationKind): boolean {
  return CHAT_KINDS.has(kind);
}

const ACTION_TEXT: Partial<Record<NotificationKind, string>> = {
  like: "Le ha gustado una publicación",
  ppv: "Ha comprado un mensaje de pago",
  tip: "Ha enviado una propina",
  subscription: "Se ha suscrito",
  renewal: "Ha renovado la suscripción",
  tag: "Te ha etiquetado",
  mention: "Te ha mencionado",
  comment: "Ha comentado",
  promotion: "Promoción",
  system: "Aviso de OnlyFans",
};

/** La acción según el tipo, para cuando OnlyFans no manda texto. No inventa datos: nombra el tipo. */
export function notificationActionText(kind: NotificationKind): string | null {
  return ACTION_TEXT[kind] ?? null;
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
  /** Type de la query. La pestaña enseña estos avisos tal cual, sin reclasificar. */
  listType?: OfNotificationListType | null;
};

export function parseNotificationPayload(value: unknown, options: ParseNotificationOptions = {}): ParsedNotification[] {
  if (options.listType === "tags") return dedupe(parseTagMentions(value, options));
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
  const raw = countSource(value);
  if (!raw) return null;
  const media = countNumber(raw.deactivated_media);
  const system = countNumber(raw.system);
  const onlyfans = media == null && system == null ? null : (media ?? 0) + (system ?? 0);
  const counts: NotificationCounts = {
    all: countNumber(raw.all),
    subscriptions: countNumber(raw.subscribed),
    purchases: countNumber(raw.purchases),
    tips: countNumber(raw.tip),
    tags: "tags" in raw ? countNumber(raw.tags) : null,
    comments: countNumber(raw.commented),
    mentions: countNumber(raw.mentioned),
    likes: countNumber(raw.favorited),
    promotions: countNumber(raw.message),
    onlyfans,
  };
  return Object.values(counts).some((item) => item != null) ? counts : null;
}

function countSource(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  for (const key of ["counters", "counts"] as const) {
    const nested = raw[key];
    if (!nested || typeof nested !== "object" || Array.isArray(nested)) continue;
    const inner = nested as Record<string, unknown>;
    if (countNumber(inner.all) != null || "subscribed" in inner || "tip" in inner || "purchases" in inner) return inner;
  }
  return raw;
}

/**
 * GET /api2/v2/release-forms/mentions → {list, hasMore, lastId}. Cada fila es una etiqueta:
 * no trae `type` de notificación, por eso no pasa por `notificationFrom`.
 * Sin id ni fecha no hay clave estable y la fila se descarta.
 */
function parseTagMentions(value: unknown, options: ParseNotificationOptions): ParsedNotification[] {
  const source = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>).list : value;
  if (!Array.isArray(source)) return [];
  const out: ParsedNotification[] = [];
  for (const item of source) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const base = item as Record<string, unknown>;
    const inner = nested(base, ["releaseForm", "form", "mention", "tag"]);
    const record: Record<string, unknown> = inner ? { ...inner, ...base } : base;
    const occurredAt = firstTime(record, ["createdAt", "created_at", "date", "createdDate", "publishedAt", "postedAt"]);
    const fan = fanOf(record);
    const self = options.accountUserId != null && fan.fanKey === options.accountUserId;
    const id = firstString(record, ["id", "releaseFormId", "formId", "guid"]);
    const key = id ? `tag:${id}` : occurredAt ? ["tag", occurredAt, fan.fanKey ?? ""].join("\u001f") : null;
    if (!key) continue;
    const card = fanCard(record);
    out.push({
      key,
      kind: "tag",
      body: notificationText(record),
      fanKey: self ? null : fan.fanKey,
      fanName: self ? null : fan.fanName,
      threadKey: null,
      amountCents: null,
      occurredAt,
      pending: false,
      ofUnread: unreadFlag(record) ?? (typeof record.isNew === "boolean" ? record.isNew : null),
      fanHandle: card.fanHandle,
      avatarUrl: card.avatarUrl,
      lists: card.lists,
      renewAuto: null,
      fanSeenAt: card.fanSeenAt,
      postRef: card.postRef,
      postLink: card.postLink,
      postText: card.postText,
      ofType: "tags",
      messageRef: null,
    });
  }
  return out;
}

/**
 * Lo que la barra lateral de OnlyFans enseña, de GET /users/me:
 * `notificationsCount` (Notificaciones), `chatMessagesCount` (Mensajes) y `newTagsCount` (Etiquetas).
 * Cada uno es null si la clave no viene. Nunca un 0 inventado.
 */
export type OfMeCounts = { notifications: number | null; chats: number | null; tags: number | null };

export function meCountsOf(value: unknown): OfMeCounts {
  const raw = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  return {
    notifications: raw ? countNumber(raw.notificationsCount) : null,
    chats: raw ? countNumber(raw.chatMessagesCount) : null,
    tags: raw ? countNumber(raw.newTagsCount) : null,
  };
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
 * cuando la relectura del contador lo dice. Un chatter no pasa de `all`.
 * Apagado, el total lo cuenta el servidor. Null si la lista no cargó.
 */
export function notificationBellCount(input: {
  markOnOnlyfans: boolean;
  counts: NotificationCounts | null;
  /** Total de Fanlink en el servidor. Null si la lista no cargó: la burbuja dice «Sin datos», no 0. */
  fanlinkTotal: number | null;
  role: "owner" | "member" | null;
}): { count: number | null; source: "onlyfans" | "fanlink" } {
  if (!input.markOnOnlyfans) {
    return { count: input.fanlinkTotal, source: "fanlink" };
  }
  return { count: onlyfansUnread(input.counts, input.role), source: "onlyfans" };
}

/** Total de no leídas del centro de OnlyFans. No es el conteo interno de Fanlink. */
export function ofNoticeTotal(counts: NotificationCounts | null): number | null {
  if (!counts) return null;
  if (counts.all != null) return counts.all;
  const parts = NOTIFICATION_TABS.filter((tab) => tab !== "all").map((tab) => counts[tab]).filter((item): item is number => item != null);
  if (parts.length === 0) return null;
  return parts.reduce((total, item) => total + item, 0);
}

function onlyfansUnread(counts: NotificationCounts | null, role: "owner" | "member" | null): number | null {
  if (!counts) return null;
  if (role === "member") {
    const present = CHATTER_COUNT_TABS.map((tab) => counts[tab]).filter((item): item is number => item != null);
    if (present.length === 0) return null;
    const sum = present.reduce((total, item) => total + item, 0);
    return counts.all == null ? sum : Math.min(counts.all, sum);
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

/** Descarta respuestas de notificaciones que ya no coinciden con la creadora o pestaña actuales. */
export function notesResponseApplies(input: {
  requestId: number;
  creatorId: string;
  tab: NotificationTab;
  currentId: number;
  currentCreatorId: string | null;
  currentTab: NotificationTab;
}): boolean {
  if (input.requestId !== input.currentId) return false;
  if (!input.creatorId || input.creatorId !== input.currentCreatorId) return false;
  return input.tab === input.currentTab;
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
    .filter((row) => query.tab === "all" || noticeTab(row) === query.tab)
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
  const listType = options.listType ?? null;
  // La pestaña no entra en la clave: la misma compra llegaba dos veces, una con of_type y otra sin.
  const storedKey = stableNoticeKey(key);
  const pending = placed.kind === "tag" && isPending(record, body);
  if (placed.kind === "ppv" && noticeDebug()) console.info(purchaseFieldTrace(record));
  const card = fanCard(record);
  return {
    key: storedKey,
    kind: placed.kind,
    body,
    fanKey: placed.fanKey,
    fanName: placed.fanName,
    threadKey,
    amountCents: amountOf(record),
    occurredAt,
    pending,
    ofUnread: unreadFlag(record),
    fanHandle: card.fanHandle,
    avatarUrl: card.avatarUrl,
    lists: card.lists,
    renewAuto: card.renewAuto,
    fanSeenAt: card.fanSeenAt,
    postRef: card.postRef,
    postLink: card.postLink,
    postText: card.postText,
    ofType: listType,
    messageRef: messageRefFromNotice(record),
  };
}

/** Quita el sufijo de pestaña (`compras` o `purchases`) para que las dos copias sean la misma fila. */
export function stableNoticeKey(key: string): string {
  return key.replace(/\u001f(?:purchases|compra|subscribed|tip|tags|commented|mentioned|favorited|promotions|message|onlyfans|deactivated_media)$/u, "");
}

const SECRET_KEY = /cookie|sign|sess|token|x-?bc|authorization/i;

function noticeDebug(): boolean {
  try {
    const raw = process.env.FANLINK_LIVE_VIEW_DEBUG?.trim().toLowerCase();
    return raw === "true" || raw === "1";
  } catch {
    return false;
  }
}

/** Nombres de claves y la ruta del enlace, con los números en `<n>`. Sin valores ni secretos. */
export function purchaseFieldTrace(record: Record<string, unknown>): string {
  const names = Object.keys(record).filter((key) => !SECRET_KEY.test(key)).sort();
  const pairs = record.replacePairs;
  if (pairs && typeof pairs === "object" && !Array.isArray(pairs)) {
    for (const key of Object.keys(pairs).filter((key) => !SECRET_KEY.test(key)).sort()) names.push(`replacePairs.${key}`);
  }
  const href = messageHref(record);
  const path = href ? redactNoticePath(href) : null;
  return `[fanlink:notif] compra campos=${names.join(",")}${path ? ` href=${path}` : ""}`;
}

/** Ruta del href. Los números pasan a `<n>`. La query no entra: puede llevar un token. */
export function redactNoticePath(raw: string): string | null {
  try {
    const url = new URL(raw, "https://onlyfans.com");
    if (url.username || url.password) return null;
    return url.pathname.replace(/\d+/g, "<n>").slice(0, 180);
  } catch {
    return null;
  }
}

/**
 * Id del mensaje y del hilo, leídos antes de quitar el HTML.
 * El enlace cuyo texto es «message», replacePairs, o un id suelto del aviso.
 */
export function messageRefFromNotice(record: Record<string, unknown>): string | null {
  const found = readMessageRef(record);
  if (!found.messageId && !found.threadId) return null;
  const parts: string[] = [];
  if (found.threadId) parts.push(`t:${found.threadId}`);
  if (found.messageId) parts.push(`m:${found.messageId}`);
  return parts.join("/");
}

function readMessageRef(record: Record<string, unknown>): { threadId: string | null; messageId: string | null } {
  let threadId = numericId(firstString(record, ["chatId", "threadId", "threadKey", "relatedChatId"]));
  let messageId = numericId(firstString(record, ["messageId", "relatedMessageId", "entityId"]));
  const chunks: string[] = [];
  const text = firstString(record, ["text", "message", "body", "content"]);
  if (text) chunks.push(text);
  const pairs = record.replacePairs;
  if (pairs && typeof pairs === "object" && !Array.isArray(pairs)) {
    for (const value of Object.values(pairs as Record<string, unknown>)) {
      if (typeof value === "string") chunks.push(value);
    }
  }
  for (const chunk of chunks) {
    const fromAnchor = hrefOfMessageAnchor(chunk);
    const raw = fromAnchor ?? (chunk.includes("<") ? null : chunk);
    if (!raw) continue;
    const parsed = idsInHref(raw);
    threadId ??= parsed.threadId;
    messageId ??= parsed.messageId;
  }
  return { threadId, messageId };
}

function hrefOfMessageAnchor(html: string): string | null {
  const pattern = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>\s*message\s*<\/a>/gi;
  const match = pattern.exec(html);
  return match?.[1] ?? null;
}

function messageHref(record: Record<string, unknown>): string | null {
  const text = firstString(record, ["text", "message", "body", "content"]);
  const fromText = text ? hrefOfMessageAnchor(text) : null;
  if (fromText) return fromText;
  const pairs = record.replacePairs;
  if (!pairs || typeof pairs !== "object" || Array.isArray(pairs)) return null;
  for (const value of Object.values(pairs as Record<string, unknown>)) {
    if (typeof value !== "string") continue;
    const href = hrefOfMessageAnchor(value);
    if (href) return href;
  }
  return null;
}

function idsInHref(raw: string): { threadId: string | null; messageId: string | null } {
  try {
    const url = new URL(raw, "https://onlyfans.com");
    const first = url.searchParams.get("firstId");
    const messageId = numericId(first) ?? pathMessageId(url.pathname);
    const thread = /\/chats\/chat\/(\d{1,18})/i.exec(url.pathname)?.[1] ?? /\/chats\/(\d{1,18})\/messages/i.exec(url.pathname)?.[1] ?? null;
    return { threadId: thread, messageId };
  } catch {
    return { threadId: null, messageId: null };
  }
}

function pathMessageId(pathname: string): string | null {
  const queue = /\/messages\/queue\/(\d{1,18})/i.exec(pathname)?.[1];
  if (queue) return queue;
  const direct = /\/messages\/(\d{1,18})/i.exec(pathname)?.[1];
  return direct ?? null;
}

/** Solo un https de onlyfans.com (o www) se puede pintar como enlace. */
export function onlyfansPostLink(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    if (url.hostname !== "onlyfans.com" && url.hostname !== "www.onlyfans.com") return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** La frase inglesa de suscripción se enseña en español. El resto se deja como viene. */
/** Parte el texto para que «message» abra el detalle y no el chat. */
export function messageLinkSpans(body: string | null, messageRef: string | null): Array<{ text: string; link: boolean }> {
  if (!body) return [];
  if (!messageRef) return [{ text: body, link: false }];
  const match = /\bmessage\b/i.exec(body);
  if (!match || match.index == null) return [{ text: body, link: false }];
  const start = match.index;
  const word = body.slice(start, start + match[0].length);
  return [
    { text: body.slice(0, start), link: false },
    { text: word, link: true },
    { text: body.slice(start + word.length), link: false },
  ].filter((part) => part.text.length > 0);
}

export function spanishNotificationText(body: string | null): string | null {
  if (!body) return null;
  return body.replace(/subscribed to your profile!?/gi, "se ha suscrito a tu perfil");
}

export function notificationStamp(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("es-ES", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Madrid",
  }).format(date);
}

const DAY_MS = 86_400_000;

/** «Reciente» solo si lastSeen viene en el JSON y cae en las últimas 24 h. */
export function isRecentFan(iso: string | null | undefined, now: number): boolean {
  if (!iso) return false;
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return false;
  const age = now - time;
  return age >= 0 && age <= DAY_MS;
}

/** Avatar y renovación del aviso, y si OF no los manda, los de la ficha o el hilo. */
export function noticeFace(input: {
  avatarUrl: string | null;
  renewAuto: boolean | null;
  threadAvatar: string | null;
  threadRenew: boolean | null;
  cardRenew: boolean | null;
}): { avatarUrl: string | null; renewAuto: boolean | null } {
  return {
    avatarUrl: input.avatarUrl ?? input.threadAvatar,
    renewAuto: input.renewAuto ?? input.threadRenew ?? input.cardRenew,
  };
}

export function renewLabel(value: boolean | null | undefined): string | null {
  if (value == null) return null;
  return value ? "Renovación sí" : "Renovación no";
}

function fanCard(record: Record<string, unknown>): {
  fanHandle: string | null;
  avatarUrl: string | null;
  lists: string[] | null;
  renewAuto: boolean | null;
  fanSeenAt: string | null;
  postRef: string | null;
  postLink: string | null;
  postText: string | null;
} {
  const people = noticePeople(record);
  const user = people[0] ?? null;
  const post = postOf(record);
  return {
    fanHandle: (user ? firstString(user, ["username"]) : null) ?? firstString(record, ["username"]),
    avatarUrl: firstNoticeAvatar(people) ?? avatarOf(record),
    lists: user ? readFanLists(user) : null,
    renewAuto: (user ? readRenew(user) : null) ?? readRenew(record),
    fanSeenAt: user ? firstTime(user, ["lastSeen"]) : null,
    postRef: post.id,
    postLink: post.link,
    postText: post.text,
  };
}

function httpsUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const clean = value.trim();
  const withProtocol = clean.startsWith("//") ? `https:${clean}` : clean;
  if (!/^https?:\/\//i.test(withProtocol) || withProtocol.length > 400) return null;
  return withProtocol;
}

const NOTICE_PERSON_KEYS = ["user", "fromUser", "relatedUser", "subscriber", "subscriberUser", "author"] as const;

export function noticePeople(record: Record<string, unknown>): Record<string, unknown>[] {
  const people: Record<string, unknown>[] = [];
  const bags = [record, record.data, record.entity].filter((value): value is Record<string, unknown> => (
    Boolean(value) && typeof value === "object" && !Array.isArray(value)
  ));
  for (const bag of bags) {
    for (const key of NOTICE_PERSON_KEYS) {
      const value = bag[key];
      if (value && typeof value === "object" && !Array.isArray(value)) people.push(value as Record<string, unknown>);
    }
  }
  return people;
}

/** Id numérico del fan. Un usuario tipo u7022542 no se convierte en número. */
export function noticeFanId(record: Record<string, unknown>): string | null {
  for (const person of noticePeople(record)) {
    const id = numericId(firstString(person, ["id", "userId", "user_id"]));
    if (id) return id;
  }
  const direct = numericId(firstString(record, ["userId", "user_id", "fanId", "fanKey", "fromUserId", "subscriberId"]));
  if (direct) return direct;
  for (const key of NOTICE_PERSON_KEYS) {
    const id = numericId(record[key]);
    if (id) return id;
  }
  const data = record.data;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const nestedId = noticeFanId(data as Record<string, unknown>);
    if (nestedId) return nestedId;
  }
  return idFromNoticeLinks(record);
}

export function hashFanId(id: string): string {
  let hash = 2166136261;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** Línea de diagnóstico: hash del id y qué campos de foto llegan. Sin URL ni id. */
export function noticeAvatarTrace(record: Record<string, unknown>): { hash: string | null; campos: string } {
  const id = noticeFanId(record);
  const parts: string[] = [];
  const slots: Array<[string, unknown]> = [
    ["user", record.user],
    ["fromUser", record.fromUser],
    ["subscriber", record.subscriber],
    ["data", dataPerson(record)],
  ];
  for (const [name, value] of slots) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      parts.push(`${name}.avatar:ausente`);
      parts.push(`${name}.avatarThumbs:ausente`);
      continue;
    }
    const person = value as Record<string, unknown>;
    parts.push(`${name}.avatar:${avatarFieldKind(person.avatar)}`);
    parts.push(`${name}.avatarThumbs:${thumbFieldKind(person.avatarThumbs)}`);
  }
  parts.push(`enlace:${idFromNoticeLinks(record) ? "id" : "ausente"}`);
  return { hash: id ? hashFanId(id) : null, campos: parts.join(",") };
}

export function noticePayloadTraces(value: unknown): string[] {
  const lines: string[] = [];
  for (const row of noticeRows(value)) {
    if (lines.length >= 20) break;
    if (firstNoticeAvatar(noticePeople(row)) || avatarOf(row)) continue;
    const trace = noticeAvatarTrace(row);
    lines.push(`[fanlink:notif] avatar hash=${trace.hash ?? "ausente"} campos=${trace.campos}`);
  }
  return lines;
}

export function firstNoticeAvatar(people: readonly Record<string, unknown>[]): string | null {
  for (const person of people) {
    const url = avatarOf(person);
    if (url) return url;
  }
  return null;
}

/** Ids sin foto, para un GET /users/list cacheado. */
export function noticeIdsMissingAvatar(rows: readonly { fanKey: string | null; avatarUrl: string | null }[]): string[] {
  const ids: string[] = [];
  for (const row of rows) {
    if (row.avatarUrl || !row.fanKey || !/^\d{1,18}$/.test(row.fanKey) || ids.includes(row.fanKey)) continue;
    ids.push(row.fanKey);
    if (ids.length >= 20) break;
  }
  return ids;
}

export function usersListPath(ids: readonly string[]): string | null {
  const clean = ids.filter((id) => /^\d{1,18}$/.test(id)).slice(0, 20);
  if (clean.length === 0) return null;
  return `/api2/v2/users/list?${clean.map((id) => `cl[]=${encodeURIComponent(id)}`).join("&")}`;
}

export function avatarsFromUserMap(value: unknown): Map<string, string> {
  const map = new Map<string, string>();
  collectDirectoryAvatars(value, null, map, 0);
  return map;
}

export function directoryAvatarReport(value: unknown): {
  shape: "mapa" | "lista" | "otro";
  devueltos: number;
  conFoto: number;
  sinFoto: number;
  sinFotoHashes: string[];
} {
  const people = directoryPeople(value);
  const sinFotoHashes: string[] = [];
  let conFoto = 0;
  for (const person of people) {
    if (avatarOf(person.record)) {
      conFoto += 1;
      continue;
    }
    if (person.id) sinFotoHashes.push(hashFanId(person.id));
  }
  return {
    shape: directoryShape(value),
    devueltos: people.length,
    conFoto,
    sinFoto: people.length - conFoto,
    sinFotoHashes,
  };
}

export function applyDirectoryAvatars<T extends { fanKey: string | null; avatarUrl?: string | null }>(
  rows: readonly T[],
  directory: ReadonlyMap<string, string>,
): T[] {
  return rows.map((row) => {
    if (row.avatarUrl || !row.fanKey) return row;
    const url = directory.get(row.fanKey);
    return url ? { ...row, avatarUrl: url } : row;
  });
}

export const NOTICE_TAB_TTL_MS = 45_000;

export function noticeTabFresh(fetchedAt: number | null, now: number, ttl = NOTICE_TAB_TTL_MS): boolean {
  return fetchedAt != null && now - fetchedAt < ttl && now >= fetchedAt;
}

function avatarOf(user: Record<string, unknown>): string | null {
  const direct = httpsUrl(user.avatar);
  if (direct) return direct;
  if (user.avatar && typeof user.avatar === "object" && !Array.isArray(user.avatar)) {
    const nested = httpsUrl((user.avatar as Record<string, unknown>).url);
    if (nested) return nested;
  }
  const thumbs = user.avatarThumbs;
  if (!thumbs || typeof thumbs !== "object" || Array.isArray(thumbs)) return null;
  const bag = thumbs as Record<string, unknown>;
  for (const key of ["c144", "c50", "c", "thumb"]) {
    const value = httpsUrl(bag[key]);
    if (value) return value;
  }
  for (const value of Object.values(bag)) {
    const url = httpsUrl(value);
    if (url) return url;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const nested = httpsUrl((value as Record<string, unknown>).url);
      if (nested) return nested;
    }
  }
  return null;
}

function readFanLists(user: Record<string, unknown>): string[] | null {
  const raw = user.listsStates ?? user.listStates ?? user.lists;
  if (!Array.isArray(raw)) return null;
  const names: string[] = [];
  for (const item of raw) {
    if (typeof item === "string" && item.trim()) {
      names.push(item.trim());
      continue;
    }
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    if (row.hasUser !== true) continue;
    const name = typeof row.name === "string" ? row.name.trim() : "";
    if (name) names.push(name);
  }
  return names;
}

function readRenew(user: Record<string, unknown>): boolean | null {
  const bags = [user.subscribedOnData, user.subscribedByData, user].filter((item): item is Record<string, unknown> => (
    Boolean(item) && typeof item === "object" && !Array.isArray(item)
  ));
  for (const bag of bags) {
    const raw = bag.autoRenew ?? bag.renewedAuto ?? bag.isAutoRenew ?? bag.renewAuto
      ?? bag.subscribedOnAutoprolong ?? bag.subscribedByAutoprolong ?? bag.autoprolong;
    const parsed = boolFlag(raw);
    if (parsed != null) return parsed;
  }
  return null;
}

function boolFlag(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (value === 1 || value === "1" || value === "true") return true;
  if (value === 0 || value === "0" || value === "false") return false;
  return null;
}

function postOf(record: Record<string, unknown>): { id: string | null; link: string | null; text: string | null } {
  const nestedPost = record.post ?? record.entity;
  const post = nestedPost && typeof nestedPost === "object" && !Array.isArray(nestedPost)
    ? nestedPost as Record<string, unknown>
    : null;
  let link = (post ? firstString(post, ["link", "url", "postLink"]) : null) ?? firstString(record, ["postLink", "postUrl", "post_link"]);
  let text = (post ? firstString(post, ["text", "rawText", "body"]) : null) ?? firstString(record, ["postText", "post_text"]);
  const pairs = record.replacePairs;
  if (pairs && typeof pairs === "object" && !Array.isArray(pairs)) {
    for (const [key, value] of Object.entries(pairs as Record<string, unknown>)) {
      if (typeof value !== "string" || !/POST/i.test(key)) continue;
      const clean = value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      if (!clean) continue;
      if (/^https?:\/\//i.test(clean)) link ??= clean;
      else if (!/^\d+$/.test(clean)) text ??= clean;
    }
  }
  const id = firstString(record, ["postId", "post_id"]) ?? (link ? /(\d{5,})/.exec(link)?.[1] ?? null : null);
  return { id, link, text };
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
  const people = noticePeople(record);
  const user = people[0] ?? null;
  const fanKey = noticeFanId(record);
  const fanName = (user ? firstString(user, ["name", "displayName"]) : null)
    ?? firstString(record, ["name", "fanName"])
    ?? (user ? firstString(user, ["username"]) : null)
    ?? firstString(record, ["username"]);
  return { fanKey, fanName };
}

function numericId(value: unknown): string | null {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return String(value);
  if (typeof value === "string" && /^\d{1,18}$/.test(value.trim())) return value.trim();
  return null;
}

function idFromNoticeLinks(record: Record<string, unknown>): string | null {
  const chunks: string[] = [];
  const text = firstString(record, ["text", "message", "body"]);
  if (text) chunks.push(text);
  const pairs = record.replacePairs;
  if (pairs && typeof pairs === "object" && !Array.isArray(pairs)) {
    for (const value of Object.values(pairs as Record<string, unknown>)) {
      if (typeof value === "string") chunks.push(value);
    }
  }
  for (const chunk of chunks) {
    const profile = /onlyfans\.com\/(\d{4,18})(?:\b|\/|\?|"|')/i.exec(chunk);
    if (profile?.[1]) return profile[1];
    const chat = /\/chats\/chat\/(\d{4,18})\b/.exec(chunk);
    if (chat?.[1]) return chat[1];
  }
  return null;
}

function dataPerson(record: Record<string, unknown>): unknown {
  const data = record.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const bag = data as Record<string, unknown>;
  return bag.user ?? bag.subscriber ?? bag.fromUser ?? null;
}

function avatarFieldKind(value: unknown): "url" | "objeto" | "vacio" | "ausente" {
  if (value == null) return "ausente";
  if (typeof value === "string") return value.trim() ? "url" : "vacio";
  if (typeof value === "object") return "objeto";
  return "vacio";
}

function thumbFieldKind(value: unknown): string {
  if (value == null) return "ausente";
  if (typeof value !== "object" || Array.isArray(value)) return "vacio";
  const keys = Object.keys(value as Record<string, unknown>).filter((key) => key !== "url").slice(0, 4);
  return keys.length > 0 ? keys.join("+") : "vacio";
}

function noticeRows(value: unknown): Record<string, unknown>[] {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item));
  const record = value as Record<string, unknown>;
  const list = record.list ?? record.items ?? record.notifications;
  if (Array.isArray(list)) return noticeRows(list);
  return [];
}

function directoryShape(value: unknown): "mapa" | "lista" | "otro" {
  if (Array.isArray(value)) return "lista";
  if (!value || typeof value !== "object") return "otro";
  const record = value as Record<string, unknown>;
  if (Array.isArray(record.list) || Array.isArray(record.users) || Array.isArray(record.items)) return "lista";
  return "mapa";
}

function directoryPeople(value: unknown): Array<{ id: string | null; record: Record<string, unknown> }> {
  const people: Array<{ id: string | null; record: Record<string, unknown> }> = [];
  collectDirectoryPeople(value, null, people, 0);
  return people;
}

function collectDirectoryPeople(
  value: unknown,
  fallbackId: string | null,
  people: Array<{ id: string | null; record: Record<string, unknown> }>,
  depth: number,
): void {
  if (!value || typeof value !== "object" || depth > 3 || people.length > 40) return;
  if (Array.isArray(value)) {
    for (const item of value) collectDirectoryPeople(item, null, people, depth + 1);
    return;
  }
  const record = value as Record<string, unknown>;
  const id = numericId(firstString(record, ["id", "userId", "user_id"])) ?? numericId(fallbackId);
  if (id && (record.avatar != null || record.avatarThumbs != null || record.username != null || record.name != null)) {
    people.push({ id, record });
    return;
  }
  const nestedList = record.list ?? record.users ?? record.items;
  if (Array.isArray(nestedList)) {
    collectDirectoryPeople(nestedList, null, people, depth + 1);
    return;
  }
  for (const [key, child] of Object.entries(record)) {
    if (!child || typeof child !== "object") continue;
    collectDirectoryPeople(child, numericId(key) ?? fallbackId, people, depth + 1);
  }
}

function collectDirectoryAvatars(value: unknown, fallbackId: string | null, map: Map<string, string>, depth: number): void {
  const people: Array<{ id: string | null; record: Record<string, unknown> }> = [];
  collectDirectoryPeople(value, fallbackId, people, depth);
  for (const person of people) {
    if (!person.id || map.has(person.id)) continue;
    const url = avatarOf(person.record);
    if (url) map.set(person.id, url);
  }
}

function unreadFlag(record: Record<string, unknown>): boolean | null {
  if (record.isRead === true || record.read === true) return false;
  if (record.isRead === false || record.read === false) return true;
  return null;
}

/** Leído en CRM cuando OnlyFans lo marca leído; si no trae el campo, usa el visto local. */
export function notificationOfRead(input: { ofUnread: boolean | null; seenAt: string | null }): boolean {
  if (input.ofUnread === false) return true;
  if (input.ofUnread === true) return false;
  return Boolean(input.seenAt);
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

function countNumber(value: unknown, depth = 0): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return Math.floor(value);
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return Number(value);
  if (depth >= 1 || !value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  return countNumber(row.unread, depth + 1);
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
    fanHandle: incoming.fanHandle ?? previous.fanHandle ?? null,
    avatarUrl: incoming.avatarUrl ?? previous.avatarUrl ?? null,
    lists: incoming.lists ?? previous.lists ?? null,
    renewAuto: incoming.renewAuto ?? previous.renewAuto ?? null,
    fanSeenAt: incoming.fanSeenAt ?? previous.fanSeenAt ?? null,
    postRef: incoming.postRef ?? previous.postRef ?? null,
    postLink: incoming.postLink ?? previous.postLink ?? null,
    postText: incoming.postText ?? previous.postText ?? null,
    ofType: incoming.ofType ?? previous.ofType ?? null,
    messageRef: incoming.messageRef ?? previous.messageRef ?? null,
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
