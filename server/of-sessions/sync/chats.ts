/**
 * Lectura de chats. Fragilidad: no hay un contrato. Se aceptan listas con
 * `withUser`, `lastMessage` y mensajes con `text` y `createdAt`. Si OnlyFans
 * cambia esos nombres, el chat queda vacío y la razón lo dice. Un chat se
 * envía solo con FANLINK_ENABLE_SEND=true y la cuenta en
 * FANLINK_SEND_ALLOW_ACCOUNTS. Los masivos siguen apagados.
 */
import { liveViewDebug } from "../live/debug.ts";
import { sectionFailure, type SectionOutcome } from "./parse.ts";
import { higherUnread, unreadCountOf } from "./unread-chats.ts";

export type ChatThread = {
  threadKey: string;
  fanKey: string | null;
  fanHandle: string | null;
  fanName: string | null;
  lastMessageAt: string | null;
  excerpt: string | null;
  /** Null si la lista firmada no trajo `unreadMessagesCount`. No es un cero. */
  unread: number | null;
  /** Id de fromUser del último mensaje. No es un chatter del CRM. */
  lastFromUserId: string | null;
  /** True si lo escribió el fan, false si salió de la cuenta, null si no se sabe. */
  lastFromFan: boolean | null;
  /** Céntimos de `subscribedOnData.totalSumm`, en dólares. 0 es un gasto real. Null si el campo no vino. */
  spentCents: number | null;
  subscribesCents: number | null;
  tipsCents: number | null;
  postsCents: number | null;
  messagesCents: number | null;
  avatarUrl: string | null;
  online: boolean | null;
  /** `lastSeen` de api2. Null si el JSON no lo trae. */
  lastSeenAt?: string | null;
  subPriceCents: number | null;
  subExpiresAt: string | null;
  /** Inicio de la suscripción y duración en meses (`subscribeAt`, `duration`). */
  subStartedAt?: string | null;
  subMonths?: number | null;
  renewAuto: boolean | null;
  /** Nombres de listas de OnlyFans. Null si el JSON no las trae. */
  lists?: string[] | null;
};

export type ChatMessage = {
  messageKey: string;
  threadKey: string;
  fanKey: string | null;
  fromFan: boolean;
  body: string;
  sentAt: string;
  /** Null si el mensaje no trae precio. */
  priceCents: number | null;
  /** Null si la página no dice si el PPV se compró. */
  purchased: boolean | null;
  /** Id de OnlyFans de quien lo envió. Vacío de chatter: no se atribuye a un empleado. */
  fromUserId: string | null;
  /** Null si OnlyFans no dice si el mensaje se vio. */
  seen: boolean | null;
  /** Null si no dice si salió de una automatización. */
  automatic: boolean | null;
  mediaCount?: number | null;
  mediaSeconds?: number | null;
  mediaPreview?: string | null;
  media?: ChatMedia[] | null;
  liked?: boolean | null;
  replyBody?: string | null;
  eventKind?: "compra" | "propina" | null;
  eventCents?: number | null;
};

export type ChatMedia = {
  kind: "foto" | "video" | "audio" | null;
  seconds: number | null;
  preview: string | null;
  /** Archivo completo (mp4, audio o m3u8) si el JSON lo trae. */
  full: string | null;
  locked: boolean | null;
  priceCents: number | null;
  paid: boolean | null;
  opened: boolean | null;
  /** Cuentas etiquetadas en el mensaje (`releaseForms` de OnlyFans). Solo si el JSON las trae. */
  tags?: ChatTag[];
};

/** Una cuenta etiquetada. OnlyFans las manda en `releaseForms[].name` y `releaseForms[].user.username`. */
export type ChatTag = { name: string | null; username: string | null };

export type FanMessageEvent = {
  id: string;
  creatorId: string;
  fanKey: string | null;
  fanName: string | null;
  excerpt: string;
  sentAt: string;
};

const LIST_KEYS = ["list", "items", "chats", "messages", "data"];
const SECRET = /password|token|cookie|secret|sess|authorization|csrf/i;

export type ChatUser = {
  id: string;
  username: string | null;
  name: string | null;
  spentCents: number | null;
  subscribesCents: number | null;
  tipsCents: number | null;
  postsCents: number | null;
  messagesCents: number | null;
  avatarUrl: string | null;
  online: boolean | null;
  lastSeenAt: string | null;
  subPriceCents: number | null;
  subExpiresAt: string | null;
  subStartedAt?: string | null;
  subMonths?: number | null;
  renewAuto: boolean | null;
};

export const CHAT_OPEN_LIMIT = 8;

/** Por defecto se abren antes los no leídos. `FANLINK_CHAT_OPEN_UNREAD=false` lo apaga. */
export function openUnreadFirst(raw: string | undefined = process.env.FANLINK_CHAT_OPEN_UNREAD): boolean {
  return raw !== "false";
}

export function threadsToOpen(
  threads: ChatThread[],
  limit = CHAT_OPEN_LIMIT,
  unreadFirst = openUnreadFirst(),
): ChatThread[] {
  return [...threads]
    .sort((left, right) => {
      if (unreadFirst) {
        const unread = Number((right.unread ?? 0) > 0) - Number((left.unread ?? 0) > 0);
        if (unread !== 0) return unread;
      }
      return (right.lastMessageAt ?? "").localeCompare(left.lastMessageAt ?? "");
    })
    .slice(0, limit);
}

/** OnlyFans pide los mensajes al abrir /my/chats/chat/{id}, no /my/chats/{id}. `inbox` es la bandeja real. */
export function chatPageUrl(chatsUrl: string, threadKey: string, siteId: string): string {
  const base = chatsUrl.replace(/\/+$/, "");
  if (!threadKey || threadKey === "inbox") return base;
  const id = encodeURIComponent(threadKey);
  if (siteId === "onlyfans") return `${base}/chat/${id}`;
  return `${base}/${id}`;
}

export function previewSender(thread: { lastFromFan: boolean | null; fanName: string | null }): string | null {
  if (thread.lastFromFan === true) return thread.fanName ?? "Fan";
  if (thread.lastFromFan === false) return "Tú";
  return null;
}

export function classifyChatPath(url: string): "list" | "messages" | "other" {
  let path = "";
  try {
    path = new URL(url).pathname.toLowerCase();
  } catch {
    return "other";
  }
  if (!path.includes("/api2/") && !path.includes("/api/")) return "other";
  if (path.includes("/messages/queue")) return "other";
  if (!path.includes("/chat") && !path.includes("/message")) return "other";
  if (/\/messages(\/|$)/.test(path) || /\/chats\/\d+$/.test(path)) return "messages";
  return "list";
}

export function isUsersDirectoryUrl(url: string): boolean {
  try {
    return new URL(url).pathname.toLowerCase().endsWith("/users/list");
  } catch {
    return false;
  }
}

export function clampChatIntervalMin(value: number): number {
  if (!Number.isFinite(value)) return 2;
  return Math.min(30, Math.max(1, Math.round(value)));
}

export function chatIntervalMinFromEnv(raw: string | undefined): number {
  if (!raw || !raw.trim()) return 2;
  return clampChatIntervalMin(Number(raw));
}

export function parseChatList(value: unknown, accountId: string | null = null): ChatThread[] {
  const rows: ChatThread[] = [];
  walk(value, 0, (record) => {
    const thread = threadFrom(record, accountId);
    if (thread) rows.push(thread);
  });
  return mergeThreads([], rows);
}

export function parsePreviewMessages(value: unknown, accountId: string | null = null): ChatMessage[] {
  const rows: ChatMessage[] = [];
  walk(value, 0, (record) => {
    const message = previewMessage(record, accountId);
    if (message) rows.push(message);
  });
  return mergeMessages([], rows);
}

export function parseChatMessages(
  value: unknown,
  threadKey: string,
  fanKey: string | null,
  accountId: string | null = null,
  source: "page" | "socket" = "page",
): ChatMessage[] {
  const rows: ChatMessage[] = [];
  let loggedPpv = false;
  walk(value, 0, (record) => {
    if (!loggedPpv && liveViewDebug() && isPpvRecord(record)) {
      loggedPpv = true;
      console.info(ppvFieldTrace(record));
    }
    const message = messageFrom(record, threadKey, fanKey, accountId, source);
    if (message) rows.push(message);
  });
  return mergeMessages([], rows);
}

/** Valores del primer PPV de la página. Sin texto, sin medios y sin secretos. */
export function ppvFieldTrace(record: Record<string, unknown>): string {
  const pick = (key: string): string => {
    const value = record[key];
    if (typeof value === "boolean") return value ? "true" : "false";
    if (typeof value === "number" && Number.isFinite(value)) return String(Math.trunc(value));
    if (typeof value === "string" && /^\d{1,18}$/.test(value.trim())) return value.trim();
    return "ausente";
  };
  return `[fanlink:chat] ppv campos=isOpened=${pick("isOpened")},canPurchase=${pick("canPurchase")},purchased=${pick("purchased")},isFree=${pick("isFree")},isFromQueue=${pick("isFromQueue")},queueId=${pick("queueId")}`;
}

function isPpvRecord(record: Record<string, unknown>): boolean {
  const price = priceCents(record.price ?? record.ppvPrice);
  return price != null && price > 0;
}

/**
 * La respuesta de POST /chats/{id}/messages es un objeto, no una lista.
 * `walk` solo entra en listas, así que el id del envío se lee aquí.
 */
export function parseWrittenMessage(
  value: unknown,
  threadKey: string,
  fanKey: string | null,
  accountId: string | null = null,
): ChatMessage[] {
  const direct: ChatMessage[] = [];
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const message = messageFrom(value as Record<string, unknown>, threadKey, fanKey, accountId, "page");
    if (message) direct.push(message);
  }
  return mergeMessages(direct, parseChatMessages(value, threadKey, fanKey, accountId));
}

export function applyAccountId(
  threads: ChatThread[],
  messages: ChatMessage[],
  accountId: string | null,
): { threads: ChatThread[]; messages: ChatMessage[] } {
  if (!accountId) return { threads, messages };
  return {
    threads: threads.map((thread) => ({
      ...thread,
      lastFromFan: fromFanFlag(thread.lastFromUserId, thread.fanKey, accountId),
    })),
    messages: messages.map((message) => {
      const flag = fromFanFlag(message.fromUserId, message.fanKey, accountId);
      return flag == null ? message : { ...message, fromFan: flag };
    }),
  };
}

function combineThread(left: ChatThread, right: ChatThread): ChatThread {
  const newer = (right.lastMessageAt ?? "") >= (left.lastMessageAt ?? "") ? right : left;
  const older = newer === right ? left : right;
  return {
    threadKey: newer.threadKey,
    fanKey: newer.fanKey ?? older.fanKey,
    fanHandle: newer.fanHandle ?? older.fanHandle,
    fanName: newer.fanName ?? older.fanName,
    lastMessageAt: newer.lastMessageAt ?? older.lastMessageAt,
    excerpt: newer.excerpt ?? older.excerpt,
    unread: higherUnread(left.unread, right.unread),
    lastFromUserId: newer.lastFromUserId ?? older.lastFromUserId,
    lastFromFan: newer.lastFromFan ?? older.lastFromFan,
    spentCents: newer.spentCents ?? older.spentCents,
    subscribesCents: newer.subscribesCents ?? older.subscribesCents,
    tipsCents: newer.tipsCents ?? older.tipsCents,
    postsCents: newer.postsCents ?? older.postsCents,
    messagesCents: newer.messagesCents ?? older.messagesCents,
    avatarUrl: newer.avatarUrl ?? older.avatarUrl,
    online: newer.online ?? older.online,
    lastSeenAt: newer.lastSeenAt ?? older.lastSeenAt ?? null,
    subPriceCents: newer.subPriceCents ?? older.subPriceCents,
    subExpiresAt: newer.subExpiresAt ?? older.subExpiresAt,
    subStartedAt: newer.subStartedAt ?? older.subStartedAt ?? null,
    subMonths: newer.subMonths ?? older.subMonths ?? null,
    renewAuto: newer.renewAuto ?? older.renewAuto,
    lists: newer.lists ?? older.lists ?? null,
  };
}

export function mergeThreads(current: ChatThread[], incoming: ChatThread[]): ChatThread[] {
  const map = new Map(current.map((row) => [row.threadKey, row]));
  for (const row of incoming) {
    const prev = map.get(row.threadKey);
    map.set(row.threadKey, prev ? combineThread(prev, row) : row);
  }
  return [...map.values()].slice(0, 200);
}

/** Una fila por fan. OnlyFans a veces manda la misma conversación con dos claves. */
export function collapseFans<T extends FanRow>(threads: T[]): T[] {
  const map = new Map<string, T>();
  for (const thread of threads) {
    const key = fanGroup(thread);
    const prev = map.get(key);
    map.set(key, prev ? preferFanRow(prev, thread) : thread);
  }
  return [...map.values()];
}

export function mergeMessages(current: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const map = new Map(current.map((row) => [row.messageKey, row]));
  for (const row of incoming) map.set(row.messageKey, row);
  return [...map.values()].slice(0, 200);
}

/** `users/list` es un mapa id → ficha, no un array. No se usa para el gasto. */
export function parseUsersDirectory(value: unknown): ChatUser[] {
  const rows: ChatUser[] = [];
  collectUsers(value, null, rows, 0);
  return mergeUsers([], rows).slice(0, 500);
}

export function mergeUsers(current: ChatUser[], incoming: ChatUser[]): ChatUser[] {
  const map = new Map(current.map((row) => [row.id, row]));
  for (const row of incoming) {
    const prev = map.get(row.id);
    map.set(row.id, prev ? {
      id: row.id,
      username: row.username ?? prev.username,
      name: row.name ?? prev.name,
      spentCents: row.spentCents ?? prev.spentCents,
      subscribesCents: row.subscribesCents ?? prev.subscribesCents,
      tipsCents: row.tipsCents ?? prev.tipsCents,
      postsCents: row.postsCents ?? prev.postsCents,
      messagesCents: row.messagesCents ?? prev.messagesCents,
      avatarUrl: row.avatarUrl ?? prev.avatarUrl,
      online: row.online ?? prev.online,
      lastSeenAt: row.lastSeenAt ?? prev.lastSeenAt ?? null,
      subPriceCents: row.subPriceCents ?? prev.subPriceCents,
      subExpiresAt: row.subExpiresAt ?? prev.subExpiresAt,
      subStartedAt: row.subStartedAt ?? prev.subStartedAt ?? null,
      subMonths: row.subMonths ?? prev.subMonths ?? null,
      renewAuto: row.renewAuto ?? prev.renewAuto,
    } : row);
  }
  return [...map.values()];
}

export function applyUserDirectory(threads: ChatThread[], users: ChatUser[]): ChatThread[] {
  const byId = new Map(users.map((user) => [user.id, user]));
  return threads.map((thread) => {
    const user = thread.fanKey ? byId.get(thread.fanKey) : undefined;
    if (!user) return thread;
    return {
      ...thread,
      fanHandle: thread.fanHandle ?? user.username,
      fanName: thread.fanName ?? user.name,
      spentCents: thread.spentCents ?? user.spentCents,
      subscribesCents: thread.subscribesCents ?? user.subscribesCents,
      tipsCents: thread.tipsCents ?? user.tipsCents,
      postsCents: thread.postsCents ?? user.postsCents,
      messagesCents: thread.messagesCents ?? user.messagesCents,
      avatarUrl: thread.avatarUrl ?? user.avatarUrl,
      online: user.online ?? thread.online,
      lastSeenAt: user.lastSeenAt ?? thread.lastSeenAt ?? null,
      subPriceCents: thread.subPriceCents ?? user.subPriceCents,
      subExpiresAt: thread.subExpiresAt ?? user.subExpiresAt,
      subStartedAt: thread.subStartedAt ?? user.subStartedAt ?? null,
      subMonths: thread.subMonths ?? user.subMonths ?? null,
      renewAuto: thread.renewAuto ?? user.renewAuto,
    };
  });
}

export function parseChatDom(threads: unknown, messages: unknown): { threads: ChatThread[]; messages: ChatMessage[] } {
  const parsedThreads = Array.isArray(threads)
    ? threads.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const record = item as Record<string, unknown>;
        const thread = threadFrom({
          id: record.id,
          withUser: { id: record.fanId, username: record.handle, name: record.name },
          unreadMessagesCount: record.unread,
          lastMessage: { text: record.excerpt, createdAt: record.at, fromUser: { id: record.fanId } },
        }, null);
        return thread ? [thread] : [];
      })
    : [];
  const parsedMessages = Array.isArray(messages)
    ? messages.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const record = item as Record<string, unknown>;
        const threadKey = clean(record.thread, 40);
        if (!threadKey) return [];
        const message = messageFrom(
          {
            id: record.id,
            text: record.body,
            createdAt: record.at,
            isMine: record.from === "team",
            fromUser: { id: record.from === "fan" ? record.fanId : "team" },
          },
          threadKey,
          clean(record.fanId, 40),
          null,
        );
        return message ? [message] : [];
      })
    : [];
  return { threads: parsedThreads, messages: parsedMessages };
}

export function newFanEvents(
  creatorId: string,
  knownKeys: ReadonlySet<string>,
  messages: ChatMessage[],
  names: ReadonlyMap<string, string | null>,
): FanMessageEvent[] {
  const events: FanMessageEvent[] = [];
  for (const message of messages) {
    if (!message.fromFan || knownKeys.has(message.messageKey)) continue;
    const excerpt = excerptOf(message.body);
    if (!excerpt) continue;
    events.push({
      id: `${creatorId}:${message.messageKey}`.slice(0, 120),
      creatorId,
      fanKey: message.fanKey,
      fanName: (message.fanKey && names.get(message.fanKey)) || null,
      excerpt,
      sentAt: message.sentAt,
    });
  }
  return events;
}

export function chatFailureReason(input: { redirected: boolean; outcome: SectionOutcome; jsonPaths: string[] }): string | null {
  if (input.redirected) return withPaths("redirigido a login", input.jsonPaths);
  const reason = sectionFailure("chats", input.outcome);
  return reason ? withPaths(reason, input.jsonPaths) : null;
}

function threadFrom(record: Record<string, unknown>, accountId: string | null): ChatThread | null {
  const user = nested(record.withUser) ?? nested(record.user) ?? nested(record.fan);
  const last = nested(record.lastMessage) ?? nested(record.last_message);
  const fanKey = personId(record.withUser) ?? personId(record.user) ?? personId(record.fan);
  const threadKey = fanKey ?? clean(record.id, 40) ?? clean(record.threadId, 40);
  const fanHandle = handle(user?.username ?? user?.handle);
  const fanName = clean(user?.name ?? user?.displayName, 80);
  const looksLikeThread = Boolean(last) || "unreadMessagesCount" in record || "canSendMessage" in record || "lastReadMessageId" in record;
  if (!threadKey || (!fanKey && !fanHandle && !fanName)) return null;
  if (!fanKey && !clean(record.id, 40) && !clean(record.threadId, 40) && !looksLikeThread) return null;
  const excerpt = excerptOf(visibleText(last?.text ?? last?.body ?? record.excerpt, 500));
  const spend = mergeSpend(readFanSpend(user), readFanSpend(chatSpend(record))) ?? emptySpend();
  const listedOnline = spend.online ?? onlineFlag(record.isOnline) ?? onlineFlag(record.online);
  const listedSeen = spend.lastSeenAt ?? iso(record.lastSeen ?? record.last_seen);
  const lastFromUserId = clean(nested(last?.fromUser)?.id, 40);
  return {
    threadKey,
    fanKey,
    fanHandle,
    fanName,
    lastMessageAt: iso(last?.createdAt ?? last?.created_at ?? record.lastMessageAt ?? record.at),
    excerpt,
    unread: unreadCountOf(record),
    lastFromUserId,
    lastFromFan: fromFanFlag(lastFromUserId, fanKey, accountId),
    ...spend,
    online: listedOnline,
    lastSeenAt: listedSeen,
    lists: readFanLists(user),
  };
}

export function readFanLists(user: Record<string, unknown> | null): string[] | null {
  if (!user) return null;
  const raw = user.lists ?? user.listsStates ?? user.listStates;
  if (!Array.isArray(raw)) return null;
  const names = raw.flatMap((item) => {
    if (typeof item === "string") {
      const name = item.replace(/\s+/g, " ").trim();
      return name ? [name.slice(0, 80)] : [];
    }
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const name = clean((item as Record<string, unknown>).name, 80);
    return name ? [name] : [];
  });
  return [...new Set(names)];
}

function fanGroup(thread: FanRow): string {
  const creator = thread.creatorId ?? "";
  const handle = thread.fanHandle?.replace(/^@/, "").trim().toLowerCase();
  if (handle) return `${creator}:h:${handle}`;
  if (thread.fanKey) return `${creator}:k:${thread.fanKey}`;
  return `${creator}:t:${thread.threadKey}`;
}

function preferFanRow<T extends FanRow>(left: T, right: T): T {
  const rank = (row: FanRow) => (row.threadKey === row.fanKey ? 4 : 0) + ((row.unread ?? 0) > 0 ? 2 : 0) + (row.excerpt ? 1 : 0);
  const primary = rank(right) > rank(left) ? right : left;
  const other = primary === left ? right : left;
  const lastMessageAt = (right.lastMessageAt ?? "") > (left.lastMessageAt ?? "") ? right.lastMessageAt : left.lastMessageAt;
  return {
    ...primary,
    unread: higherUnread(left.unread, right.unread),
    excerpt: primary.excerpt ?? other.excerpt,
    lastMessageAt,
  };
}

type FanRow = {
  creatorId?: string;
  threadKey: string;
  fanKey: string | null;
  fanHandle: string | null;
  fanName: string | null;
  unread: number | null;
  excerpt: string | null;
  lastMessageAt: string | null;
};

function previewMessage(record: Record<string, unknown>, accountId: string | null): ChatMessage | null {
  const user = nested(record.withUser) ?? nested(record.user) ?? nested(record.fan);
  const fanKey = clean(user?.id, 40);
  const threadKey = fanKey ?? clean(record.id, 40) ?? clean(record.threadId, 40);
  const last = nested(record.lastMessage) ?? nested(record.last_message);
  if (!threadKey || !last) return null;
  return messageFrom(last, threadKey, fanKey, accountId);
}

function messageFrom(
  record: Record<string, unknown>,
  threadKey: string,
  fanKey: string | null,
  accountId: string | null,
  source: "page" | "socket" = "page",
): ChatMessage | null {
  const body = messageText(record.text ?? record.body, 2000) ?? "";
  const sentAt = iso(record.createdAt ?? record.created_at ?? record.at);
  const messageKey = clean(record.id, 40);
  const media = mediaItems(record);
  const event = eventFrom(record, body);
  if ((!body && media.length === 0 && !event) || !sentAt || !messageKey) return null;
  const chat = nested(record.chat);
  const ownThread = clean(record.chatId, 40) ?? clean(record.chat_id, 40) ?? clean(chat?.id, 40);
  const fromId = clean(nested(record.fromUser)?.id, 40);
  const withId = clean(nested(record.withUser)?.id, 40);
  const toId = clean(nested(record.toUser)?.id, 40);
  const verified = threadKey && (fromId === threadKey || withId === threadKey) ? threadKey : null;
  const other = [withId, fromId, toId].find((id) => id != null && id !== accountId) ?? null;
  const thread = ownThread ?? (source === "socket" ? verified ?? (accountId ? other : null) : threadKey);
  if (!thread) return null;
  const fan = ownThread ?? (source === "socket" && thread !== threadKey ? thread : fanKey);
  const fromUserId = fromId;
  const flag = fromFanFlag(fromUserId, fan, accountId);
  return {
    messageKey,
    threadKey: thread,
    fanKey: fan,
    fromFan: flag ?? isFromFan(record, fanKey),
    fromUserId,
    seen: seenFlag(record),
    automatic: record.isFromQueue === true || record.isAutomated === true ? true : null,
    body,
    sentAt,
    priceCents: priceCents(record.price ?? record.ppvPrice),
    purchased: purchasedFlag(record, priceCents(record.price ?? record.ppvPrice), ownMessage(record, accountId)),
    ...mediaFacts(record),
    media,
    liked: likedFlag(record),
    replyBody: replyText(record),
    eventKind: event?.kind ?? null,
    eventCents: event?.cents ?? null,
  };
}

function priceCents(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return Math.round(value * 100);
  if (typeof value === "string" && /^\d+(\.\d{1,2})?$/.test(value.trim())) return Math.round(Number(value) * 100);
  return null;
}

/**
 * En un mensaje propio, `canPurchase` y `purchased` hablan de quien mira.
 * `isOpened` en true cuenta como pagado. En false no se niega la compra:
 * Alz2000 tiene 12 PPV sin abrir y las compras están en avisos y movimientos.
 */
export function purchasedFlag(record: Record<string, unknown>, price: number | null, own = false): boolean | null {
  if (own && price != null && price > 0) {
    if (record.isOpened === true) return true;
    return null;
  }
  if (typeof record.purchased === "boolean") return record.purchased;
  if (typeof record.isPurchased === "boolean") return record.isPurchased;
  if (price == null || price <= 0) return null;
  if (typeof record.canPurchase === "boolean") return !record.canPurchase;
  if (typeof record.isOpened === "boolean") return record.isOpened;
  return null;
}

function ownMessage(record: Record<string, unknown>, accountId: string | null): boolean {
  if (record.isMine === true || record.isFromMe === true || record.from === "team") return true;
  const fromId = clean(nested(record.fromUser)?.id, 40);
  return accountId != null && fromId === accountId;
}

function mediaFacts(record: Record<string, unknown>): { mediaCount: number | null; mediaSeconds: number | null; mediaPreview: string | null } {
  const items = mediaItems(record);
  if (items.length === 0) return { mediaCount: null, mediaSeconds: null, mediaPreview: null };
  const seconds = items.reduce((sum, item) => sum + (item.seconds ?? 0), 0);
  const haveSeconds = items.some((item) => item.seconds != null);
  return {
    mediaCount: items.length,
    mediaSeconds: haveSeconds ? Math.round(seconds) : null,
    mediaPreview: items.find((item) => item.preview)?.preview ?? null,
  };
}

export function mediaItems(record: Record<string, unknown>): ChatMedia[] {
  const raw = record.media ?? record.previews ?? record.attachments;
  if (!Array.isArray(raw)) return [];
  const messagePrice = priceCents(record.price ?? record.ppvPrice);
  const messagePaid = purchasedFlag(record, messagePrice, record.isMine === true || record.isFromMe === true);
  const tags = releaseTags(record);
  return raw.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const row = item as Record<string, unknown>;
    const files = nested(row.files);
    const preview = mediaUrl(row.thumb ?? row.preview ?? files?.thumb ?? nested(files?.thumb)?.url ?? files?.squarePreview);
    const full = fullMediaUrl(row, files);
    const secondsValue = row.duration ?? row.durationSeconds;
    const seconds = typeof secondsValue === "number" && Number.isFinite(secondsValue) && secondsValue >= 0 ? Math.round(secondsValue) : null;
    const ownPrice = priceCents(row.price);
    const locked = typeof row.canView === "boolean" ? row.canView === false : typeof row.isLocked === "boolean" ? row.isLocked === true : null;
    const opened = typeof row.isOpened === "boolean" ? row.isOpened : null;
    return [{
      ...(tags.length > 0 ? { tags } : {}),
      kind: mediaKind(row.type ?? row.mediaType),
      seconds,
      preview,
      full,
      locked,
      priceCents: ownPrice ?? messagePrice,
      paid: opened ?? messagePaid,
      opened,
    }];
  });
}

/** Etiquetas del mensaje: quién va etiquetado en el medio. OnlyFans las manda por mensaje, no por medio. */
export function releaseTags(record: Record<string, unknown>): ChatTag[] {
  const raw = record.releaseForms;
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const tags: ChatTag[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const user = nested(row.user);
    const name = clean(row.name, 60) ?? clean(user?.name, 60);
    const username = clean(user?.username, 60)?.replace(/^@+/, "") ?? null;
    if (!name && !username) continue;
    const key = (username ?? name ?? "").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push({ name: name ?? null, username });
    if (tags.length >= 8) break;
  }
  return tags;
}

function mediaKind(value: unknown): ChatMedia["kind"] {
  const text = clean(value, 20)?.toLowerCase() ?? "";
  if (text === "photo" || text === "image" || text === "foto") return "foto";
  if (text === "video") return "video";
  if (text === "audio") return "audio";
  return null;
}

function likedFlag(record: Record<string, unknown>): boolean | null {
  if (typeof record.isLiked === "boolean") return record.isLiked;
  if (typeof record.isFavorite === "boolean") return record.isFavorite;
  return null;
}

function replyText(record: Record<string, unknown>): string | null {
  const reply = nested(record.replyToMessage) ?? nested(record.replyTo);
  return visibleText(reply?.text ?? record.replyText, 240);
}

function eventFrom(record: Record<string, unknown>, body: string): { kind: "compra" | "propina"; cents: number | null } | null {
  const tip = priceCents(record.tipAmount ?? record.tipSum);
  if (record.isTip === true || record.type === "tip") return { kind: "propina", cents: tip };
  if (/purchased your message/i.test(body) || record.type === "paided_message" || record.type === "purchase") {
    return { kind: "compra", cents: priceCents(record.amount ?? record.price) ?? centsInText(body) };
  }
  return null;
}

function centsInText(body: string): number | null {
  const match = body.match(/\$(\d+(?:\.\d{1,2})?)/);
  return match?.[1] ? priceCents(match[1]) : null;
}

function fullMediaUrl(row: Record<string, unknown>, files: Record<string, unknown> | null): string | null {
  const sources = nested(row.videoSources);
  const ranked = sources
    ? Object.entries(sources).sort((left, right) => Number(right[0]) - Number(left[0])).map((entry) => mediaUrl(entry[1]))
    : [];
  const drm = nested(files?.drm);
  const manifest = nested(drm?.manifest);
  return mediaUrl(files?.full)
    ?? mediaUrl(files?.source)
    ?? mediaUrl(row.source)
    ?? mediaUrl(row.src)
    ?? ranked.find((item): item is string => item != null)
    ?? mediaUrl(manifest?.hls)
    ?? mediaUrl(files?.hls)
    ?? null;
}

function mediaUrl(value: unknown): string | null {
  const nestedUrl = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>).url : value;
  if (typeof nestedUrl !== "string" || !/^https?:\/\//.test(nestedUrl) || nestedUrl.length > 2000) return null;
  return nestedUrl;
}

export function fromFanFlag(fromUserId: string | null, fanKey: string | null, accountId: string | null): boolean | null {
  if (!fromUserId) return null;
  if (accountId && fromUserId === accountId) return false;
  if (fanKey && fromUserId === fanKey) return true;
  if (accountId) return true;
  return null;
}

function emptySpend(): Pick<ChatThread, "spentCents" | "subscribesCents" | "tipsCents" | "postsCents" | "messagesCents" | "avatarUrl" | "online" | "lastSeenAt" | "subPriceCents" | "subExpiresAt" | "subStartedAt" | "subMonths" | "renewAuto"> {
  return {
    spentCents: null,
    subscribesCents: null,
    tipsCents: null,
    postsCents: null,
    messagesCents: null,
    avatarUrl: null,
    online: null,
    lastSeenAt: null,
    subPriceCents: null,
    subExpiresAt: null,
    subStartedAt: null,
    subMonths: null,
    renewAuto: null,
  };
}

function seenFlag(record: Record<string, unknown>): boolean | null {
  if (typeof record.isOpened === "boolean") return record.isOpened;
  if (typeof record.isNew === "boolean") return !record.isNew;
  return null;
}

function chatSpend(record: Record<string, unknown>): Record<string, unknown> | null {
  const nestedSpend = nested(record.subscribedOnData) ?? nested(record.subscribedByData);
  return nestedSpend ? { subscribedOnData: nestedSpend } : null;
}

function mergeSpend(
  left: ReturnType<typeof readFanSpend>,
  right: ReturnType<typeof readFanSpend>,
): ReturnType<typeof readFanSpend> {
  if (!left) return right;
  if (!right) return left;
  return {
    spentCents: left.spentCents ?? right.spentCents,
    subscribesCents: left.subscribesCents ?? right.subscribesCents,
    tipsCents: left.tipsCents ?? right.tipsCents,
    postsCents: left.postsCents ?? right.postsCents,
    messagesCents: left.messagesCents ?? right.messagesCents,
    avatarUrl: left.avatarUrl ?? right.avatarUrl,
    online: left.online ?? right.online,
    lastSeenAt: left.lastSeenAt ?? right.lastSeenAt,
    subPriceCents: left.subPriceCents ?? right.subPriceCents,
    subExpiresAt: left.subExpiresAt ?? right.subExpiresAt,
    subStartedAt: left.subStartedAt ?? right.subStartedAt ?? null,
    subMonths: left.subMonths ?? right.subMonths ?? null,
    renewAuto: left.renewAuto ?? right.renewAuto,
  };
}

function readFanSpend(
  record: Record<string, unknown> | null,
): Pick<ChatThread, "spentCents" | "subscribesCents" | "tipsCents" | "postsCents" | "messagesCents" | "avatarUrl" | "online" | "lastSeenAt" | "subPriceCents" | "subExpiresAt" | "subStartedAt" | "subMonths" | "renewAuto"> | null {
  if (!record) return null;
  const nestedSpend = nested(record.subscribedOnData) ?? nested(record.subscribedByData);
  const source = nestedSpend ?? record;
  const subscribesCents = money(source.subscribesSum ?? source.subscribesSumm);
  const tipsCents = money(source.tipsSumm ?? source.tipsSum);
  const postsCents = money(source.postsSumm ?? source.postsSum);
  const messagesCents = money(source.messagesSumm ?? source.messagesSum);
  const spentCents = money(source.totalSumm ?? source.spent ?? source.totalSpent);
  const avatarUrl = clean(record.avatar, 400);
  const online = onlineFlag(record.isOnline) ?? onlineFlag(record.online);
  const lastSeenAt = iso(record.lastSeen ?? record.last_seen ?? record.seenAt);
  const sub = readSubscription(source);
  const subPriceCents = sub.priceCents;
  const subExpiresAt = sub.expiresAt;
  const subStartedAt = sub.startedAt;
  const subMonths = sub.months;
  const renewRaw = source.autoRenew ?? source.renewedAuto ?? source.isAutoRenew ?? source.subscribedOnAutoprolong ?? source.subscribedByAutoprolong ?? source.autoprolong ?? record.autoRenew ?? record.subscribedOnAutoprolong ?? record.subscribedByAutoprolong;
  const renewAuto = renewRaw === true || renewRaw === false ? renewRaw : null;
  const card = { spentCents, subscribesCents, tipsCents, postsCents, messagesCents, avatarUrl, online, lastSeenAt, subPriceCents, subExpiresAt, subStartedAt, subMonths, renewAuto };
  const parts = [subscribesCents, tipsCents, postsCents, messagesCents].filter((value) => value != null);
  if (spentCents == null && parts.length === 0 && !avatarUrl && online == null && !lastSeenAt && subPriceCents == null && !subExpiresAt && !subStartedAt && renewAuto == null) return null;
  return card;
}

/**
 * `price` viene a 0 cuando OnlyFans no lo rellena para este fan (Maik: Infloww dice $9.99).
 * Se usa el primer importe positivo de los campos de precio, en el orden de las fuentes dadas.
 * Si todos son 0, es gratis. Si ninguno viene, null.
 */
export function subscriptionPriceCents(...sources: Array<Record<string, unknown> | null | undefined>): number | null {
  const found = sources.flatMap((source) => source
    ? [source.price, source.subscribePrice, source.currentSubscribePrice, source.regularPrice].map(money)
    : []);
  const positive = found.find((value) => value != null && value > 0);
  if (positive != null) return positive;
  return found.find((value) => value != null) ?? null;
}

/**
 * Suscripción del fan en `subscribedOnData`/`subscribedByData`: precio, inicio, meses y caducidad.
 * Si trae la lista `subscribes`, la vigente (`isCurrent`, o la de inicio más reciente) completa lo que falte.
 */
export function readSubscription(source: Record<string, unknown>): {
  priceCents: number | null;
  startedAt: string | null;
  months: number | null;
  expiresAt: string | null;
} {
  const list = Array.isArray(source.subscribes)
    ? source.subscribes.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
  const current = list.find((item) => item.isCurrent === true)
    ?? [...list].sort((left, right) => String(iso(right.startDate ?? right.date) ?? "").localeCompare(String(iso(left.startDate ?? left.date) ?? "")))[0]
    ?? null;
  const monthsRaw = source.duration ?? source.subscribedOnDuration ?? current?.duration;
  const monthsMatch = typeof monthsRaw === "number" ? monthsRaw : typeof monthsRaw === "string" ? Number(/^\d+/.exec(monthsRaw.trim())?.[0]) : Number.NaN;
  return {
    priceCents: subscriptionPriceCents(source, current),
    startedAt: iso(source.subscribeAt ?? source.subscribedAt ?? source.startDate ?? current?.startDate ?? current?.date),
    months: Number.isFinite(monthsMatch) && monthsMatch > 0 && monthsMatch <= 120 ? Math.round(monthsMatch) : null,
    expiresAt: iso(source.expiredAt ?? source.expireDate ?? current?.expireDate),
  };
}

function onlineFlag(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (value === 1 || value === "1" || value === "true") return true;
  if (value === 0 || value === "0" || value === "false") return false;
  return null;
}

function money(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return Math.round(value * 100);
  if (typeof value === "string" && /^\d+(\.\d{1,2})?$/.test(value.trim())) return Math.round(Number(value) * 100);
  return null;
}

function isFromFan(record: Record<string, unknown>, fanKey: string | null): boolean {
  if (record.isMine === true || record.isFromMe === true || record.from === "team") return false;
  if (record.from === "fan") return true;
  const fromUser = nested(record.fromUser);
  const fromId = clean(fromUser?.id, 40);
  if (fanKey && fromId) return fromId === fanKey;
  return false;
}

function walk(value: unknown, depth: number, visit: (record: Record<string, unknown>) => void): void {
  if (!value || typeof value !== "object" || depth > 4) return;
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 200)) {
      if (item && typeof item === "object" && !Array.isArray(item)) visit(item as Record<string, unknown>);
    }
    return;
  }
  const record = value as Record<string, unknown>;
  for (const [key, child] of Object.entries(record)) {
    if (SECRET.test(key) || !LIST_KEYS.includes(key)) continue;
    walk(child, depth + 1, visit);
  }
}

function excerptOf(value: string | null): string | null {
  if (!value) return null;
  const text = value.replace(/\s+/g, " ").trim();
  if (!text || SECRET.test(text)) return null;
  return text.slice(0, 140);
}

function personId(value: unknown): string | null {
  if (typeof value === "number" || typeof value === "string") return clean(value, 40);
  return clean(nested(value)?.id, 40);
}

function nested(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function clean(value: unknown, max: number): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(Math.trunc(value)).slice(0, max);
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.slice(0, max);
}

function handle(value: unknown): string | null {
  const text = clean(value, 80);
  return text ? text.replace(/^@+/, "") : null;
}

function iso(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 1_000_000_000) {
    const millis = value > 10_000_000_000 ? value : value * 1000;
    const date = new Date(millis);
    if (Number.isNaN(date.getTime())) return null;
    return date.toISOString();
  }
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

/** Texto del mensaje con los párrafos y saltos de línea de OnlyFans. Una línea por párrafo. */
function messageText(value: unknown, max: number): string | null {
  const raw = clean(value, max * 4);
  if (!raw) return null;
  const text = raw
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
  if (!text) return null;
  return text.slice(0, max);
}

function visibleText(value: unknown, max: number): string | null {
  const raw = clean(value, max * 4);
  if (!raw) return null;
  const text = raw
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;
  return text.slice(0, max);
}

function collectUsers(value: unknown, fallbackId: string | null, rows: ChatUser[], depth: number): void {
  if (!value || typeof value !== "object" || depth > 2 || rows.length > 500) return;
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 500)) collectUsers(item, null, rows, depth + 1);
    return;
  }
  const record = value as Record<string, unknown>;
  const direct = userFrom(record, fallbackId);
  if (direct && (direct.username || direct.name || clean(record.id, 40))) {
    rows.push(direct);
    return;
  }
  const nestedList = record.list ?? record.users ?? record.items;
  if (Array.isArray(nestedList)) {
    collectUsers(nestedList, null, rows, depth + 1);
    return;
  }
  for (const [key, child] of Object.entries(record)) {
    if (!child || typeof child !== "object" || Array.isArray(child)) continue;
    collectUsers(child, /^\d+$/.test(key) ? key : null, rows, depth + 1);
  }
}

function userFrom(record: Record<string, unknown>, fallbackId: string | null): ChatUser | null {
  const id = clean(record.id, 40) ?? fallbackId;
  if (!id) return null;
  const spend = readFanSpend(record) ?? emptySpend();
  return {
    id,
    username: handle(record.username ?? record.handle),
    name: clean(record.name ?? record.displayName, 80),
    ...spend,
    lastSeenAt: spend.lastSeenAt ?? null,
  };
}

function count(value: unknown): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number) || number < 0) return 0;
  return Math.min(999, Math.trunc(number));
}

function withPaths(reason: string, _paths: string[]): string {
  return reason.slice(0, 180);
}
