/**
 * Lectura de chats. Fragilidad: no hay un contrato. Se aceptan listas con
 * `withUser`, `lastMessage` y mensajes con `text` y `createdAt`. Si OnlyFans
 * cambia esos nombres, el chat queda vacío y la razón lo dice. No se envía nada.
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

export type ChatUser = { id: string; username: string | null; name: string | null };

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

export function parseChatList(value: unknown): ChatThread[] {
  const rows: ChatThread[] = [];
  walk(value, 0, (record) => {
    const thread = threadFrom(record);
    if (thread) rows.push(thread);
  });
  return mergeThreads([], rows);
}

export function parseChatMessages(value: unknown, threadKey: string, fanKey: string | null): ChatMessage[] {
  const rows: ChatMessage[] = [];
  walk(value, 0, (record) => {
    const message = messageFrom(record, threadKey, fanKey);
    if (message) rows.push(message);
  });
  return mergeMessages([], rows);
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
    map.set(row.id, prev ? { id: row.id, username: row.username ?? prev.username, name: row.name ?? prev.name } : row);
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
        });
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

function threadFrom(record: Record<string, unknown>): ChatThread | null {
  const user = nested(record.withUser) ?? nested(record.user) ?? nested(record.fan);
  const last = nested(record.lastMessage) ?? nested(record.last_message);
  const fanKey = clean(user?.id, 40);
  const threadKey = clean(record.id, 40) ?? clean(record.threadId, 40) ?? fanKey;
  const fanHandle = handle(user?.username ?? user?.handle);
  const fanName = clean(user?.name ?? user?.displayName, 80);
  const looksLikeThread = Boolean(last) || "unreadMessagesCount" in record || "canSendMessage" in record || "lastReadMessageId" in record;
  if (!threadKey || (!fanKey && !fanHandle && !fanName)) return null;
  if (!clean(record.id, 40) && !clean(record.threadId, 40) && !looksLikeThread) return null;
  const excerpt = excerptOf(visibleText(last?.text ?? last?.body ?? record.excerpt, 500));
  return {
    threadKey,
    fanKey,
    fanHandle,
    fanName,
    lastMessageAt: iso(last?.createdAt ?? last?.created_at ?? record.lastMessageAt ?? record.at),
    excerpt,
    unread: count(record.unreadMessagesCount ?? record.unread),
  };
}

function messageFrom(record: Record<string, unknown>, threadKey: string, fanKey: string | null): ChatMessage | null {
  const body = visibleText(record.text ?? record.body, 2000);
  const sentAt = iso(record.createdAt ?? record.created_at ?? record.at);
  const messageKey = clean(record.id, 40);
  if (!body || !sentAt || !messageKey) return null;
  return {
    messageKey,
    threadKey,
    fanKey,
    fromFan: isFromFan(record, fanKey),
    body,
    sentAt,
    priceCents: priceCents(record.price ?? record.ppvPrice),
    purchased: purchasedFlag(record),
  };
}

function priceCents(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return Math.round(value * 100);
  if (typeof value === "string" && /^\d+(\.\d{1,2})?$/.test(value.trim())) return Math.round(Number(value) * 100);
  return null;
}

function purchasedFlag(record: Record<string, unknown>): boolean | null {
  if (typeof record.purchased === "boolean") return record.purchased;
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
  return {
    id,
    username: handle(record.username ?? record.handle),
    name: clean(record.name ?? record.displayName, 80),
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
