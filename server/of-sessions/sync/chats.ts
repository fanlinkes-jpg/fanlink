/**
 * Lectura de chats. Fragilidad: no hay un contrato. Se aceptan listas con
 * `withUser`, `lastMessage` y mensajes con `text` y `createdAt`. Si OnlyFans
 * cambia esos nombres, el chat queda vacío y la razón lo dice. Un chat se
 * envía solo con FANLINK_ENABLE_SEND=true y la cuenta en
 * FANLINK_SEND_ALLOW_ACCOUNTS. Los masivos siguen apagados.
 */
import { sectionFailure, type SectionOutcome } from "./parse.ts";

export type ChatThread = {
  threadKey: string;
  fanKey: string | null;
  fanHandle: string | null;
  fanName: string | null;
  lastMessageAt: string | null;
  excerpt: string | null;
  unread: number;
  /** Id de fromUser del último mensaje. No es un chatter del CRM. */
  lastFromUserId: string | null;
  /** True si lo escribió el fan, false si salió de la cuenta, null si no se sabe. */
  lastFromFan: boolean | null;
  spentCents: number | null;
  subscribesCents: number | null;
  tipsCents: number | null;
  postsCents: number | null;
  messagesCents: number | null;
  avatarUrl: string | null;
  online: boolean | null;
  subPriceCents: number | null;
  subExpiresAt: string | null;
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
};

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
  subPriceCents: number | null;
  subExpiresAt: string | null;
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
        const unread = Number(right.unread > 0) - Number(left.unread > 0);
        if (unread !== 0) return unread;
      }
      return (right.lastMessageAt ?? "").localeCompare(left.lastMessageAt ?? "");
    })
    .slice(0, limit);
}

/** OnlyFans pide los mensajes al abrir /my/chats/chat/{id}, no /my/chats/{id}. */
export function chatPageUrl(chatsUrl: string, threadKey: string, siteId: string): string {
  const base = chatsUrl.replace(/\/+$/, "");
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
  walk(value, 0, (record) => {
    const message = messageFrom(record, threadKey, fanKey, accountId, source);
    if (message) rows.push(message);
  });
  return mergeMessages([], rows);
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
    unread: Math.max(left.unread, right.unread),
    lastFromUserId: newer.lastFromUserId ?? older.lastFromUserId,
    lastFromFan: newer.lastFromFan ?? older.lastFromFan,
    spentCents: newer.spentCents ?? older.spentCents,
    subscribesCents: newer.subscribesCents ?? older.subscribesCents,
    tipsCents: newer.tipsCents ?? older.tipsCents,
    postsCents: newer.postsCents ?? older.postsCents,
    messagesCents: newer.messagesCents ?? older.messagesCents,
    avatarUrl: newer.avatarUrl ?? older.avatarUrl,
    online: newer.online ?? older.online,
    subPriceCents: newer.subPriceCents ?? older.subPriceCents,
    subExpiresAt: newer.subExpiresAt ?? older.subExpiresAt,
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

export function mergeMessages(current: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const map = new Map(current.map((row) => [row.messageKey, row]));
  for (const row of incoming) map.set(row.messageKey, row);
  return [...map.values()].slice(0, 200);
}

/** `users/list` es un mapa id → ficha, no un array. */
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
      subPriceCents: row.subPriceCents ?? prev.subPriceCents,
      subExpiresAt: row.subExpiresAt ?? prev.subExpiresAt,
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
      online: thread.online ?? user.online,
      subPriceCents: thread.subPriceCents ?? user.subPriceCents,
      subExpiresAt: thread.subExpiresAt ?? user.subExpiresAt,
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
  const fanKey = clean(user?.id, 40);
  const threadKey = fanKey ?? clean(record.id, 40) ?? clean(record.threadId, 40);
  const fanHandle = handle(user?.username ?? user?.handle);
  const fanName = clean(user?.name ?? user?.displayName, 80);
  const looksLikeThread = Boolean(last) || "unreadMessagesCount" in record || "canSendMessage" in record || "lastReadMessageId" in record;
  if (!threadKey || (!fanKey && !fanHandle && !fanName)) return null;
  if (!fanKey && !clean(record.id, 40) && !clean(record.threadId, 40) && !looksLikeThread) return null;
  const excerpt = excerptOf(visibleText(last?.text ?? last?.body ?? record.excerpt, 500));
  const spend = readFanSpend(user) ?? emptySpend();
  const lastFromUserId = clean(nested(last?.fromUser)?.id, 40);
  return {
    threadKey,
    fanKey,
    fanHandle,
    fanName,
    lastMessageAt: iso(last?.createdAt ?? last?.created_at ?? record.lastMessageAt ?? record.at),
    excerpt,
    unread: count(record.unreadMessagesCount ?? record.unread),
    lastFromUserId,
    lastFromFan: fromFanFlag(lastFromUserId, fanKey, accountId),
    ...spend,
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
  const body = visibleText(record.text ?? record.body, 2000) ?? "";
  const sentAt = iso(record.createdAt ?? record.created_at ?? record.at);
  const messageKey = clean(record.id, 40);
  const media = mediaItems(record);
  const event = eventFrom(record, body);
  if ((!body && media.length === 0 && !event) || !sentAt || !messageKey) return null;
  const chat = nested(record.chat);
  const ownThread = clean(record.chatId, 40) ?? clean(record.chat_id, 40) ?? clean(chat?.id, 40);
  const fromId = clean(nested(record.fromUser)?.id, 40);
  const withId = clean(nested(record.withUser)?.id, 40);
  const verified = threadKey && (fromId === threadKey || withId === threadKey) ? threadKey : null;
  const thread = ownThread ?? (source === "socket" ? verified : threadKey);
  if (!thread) return null;
  const fan = ownThread ?? fanKey;
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
    purchased: purchasedFlag(record, priceCents(record.price ?? record.ppvPrice)),
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

function purchasedFlag(record: Record<string, unknown>, price: number | null): boolean | null {
  if (typeof record.purchased === "boolean") return record.purchased;
  if (typeof record.isPurchased === "boolean") return record.isPurchased;
  if (price == null || price <= 0) return null;
  if (typeof record.canPurchase === "boolean") return !record.canPurchase;
  if (typeof record.isOpened === "boolean") return record.isOpened;
  return null;
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
  const messagePaid = purchasedFlag(record, messagePrice);
  return raw.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const row = item as Record<string, unknown>;
    const files = nested(row.files);
    const preview = mediaUrl(row.thumb ?? row.preview ?? files?.thumb ?? nested(files?.thumb)?.url ?? files?.squarePreview);
    const full = fullMediaUrl(row, files);
    const secondsValue = row.duration ?? row.durationSeconds;
    const seconds = typeof secondsValue === "number" && Number.isFinite(secondsValue) && secondsValue >= 0 ? Math.round(secondsValue) : null;
    const ownPrice = priceCents(row.price);
    const locked = row.canView === false || row.isLocked === true ? true : row.canView === true || row.isLocked === false ? false : null;
    const opened = typeof row.isOpened === "boolean" ? row.isOpened : null;
    return [{
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

function emptySpend(): Pick<ChatThread, "spentCents" | "subscribesCents" | "tipsCents" | "postsCents" | "messagesCents" | "avatarUrl" | "online" | "subPriceCents" | "subExpiresAt" | "renewAuto"> {
  return {
    spentCents: null,
    subscribesCents: null,
    tipsCents: null,
    postsCents: null,
    messagesCents: null,
    avatarUrl: null,
    online: null,
    subPriceCents: null,
    subExpiresAt: null,
    renewAuto: null,
  };
}

function seenFlag(record: Record<string, unknown>): boolean | null {
  if (typeof record.isOpened === "boolean") return record.isOpened;
  if (typeof record.isNew === "boolean") return !record.isNew;
  return null;
}

function readFanSpend(
  record: Record<string, unknown> | null,
): Pick<ChatThread, "spentCents" | "subscribesCents" | "tipsCents" | "postsCents" | "messagesCents" | "avatarUrl" | "online" | "subPriceCents" | "subExpiresAt" | "renewAuto"> | null {
  if (!record) return null;
  const nestedSpend = nested(record.subscribedOnData) ?? nested(record.subscribedByData);
  const source = nestedSpend ?? record;
  const subscribesCents = money(source.subscribesSum ?? source.subscribesSumm);
  const tipsCents = money(source.tipsSumm ?? source.tipsSum);
  const postsCents = money(source.postsSumm ?? source.postsSum);
  const messagesCents = money(source.messagesSumm ?? source.messagesSum);
  const parts = [subscribesCents, tipsCents, postsCents, messagesCents].filter((value): value is number => value != null);
  const spentCents = money(source.totalSumm ?? source.spent ?? source.totalSpent) ?? (parts.length ? parts.reduce((sum, value) => sum + value, 0) : null);
  const avatarUrl = clean(record.avatar, 400);
  const online = typeof record.isOnline === "boolean" ? record.isOnline : typeof record.online === "boolean" ? record.online : null;
  const subPriceCents = money(source.price ?? source.subscribePrice ?? source.regularPrice);
  const subExpiresAt = iso(source.expiredAt ?? source.expireDate);
  const renewRaw = source.autoRenew ?? source.renewedAuto ?? record.autoRenew;
  const renewAuto = renewRaw === true || renewRaw === false ? renewRaw : null;
  const card = { spentCents, subscribesCents, tipsCents, postsCents, messagesCents, avatarUrl, online, subPriceCents, subExpiresAt, renewAuto };
  if (spentCents == null && parts.length === 0 && !avatarUrl && online == null && subPriceCents == null && !subExpiresAt && renewAuto == null) return null;
  return card;
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
