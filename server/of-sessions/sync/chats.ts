/**
 * Lectura de chats. Fragilidad: no hay un contrato. Se aceptan listas con
 * `withUser`, `lastMessage` y mensajes con `text` y `createdAt`. Si OnlyFans
 * cambia esos nombres, el chat queda vacío y la razón lo dice. No se envía nada.
 */

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

export function classifyChatPath(url: string): "list" | "messages" | "other" {
  let path = "";
  try {
    path = new URL(url).pathname.toLowerCase();
  } catch {
    return "other";
  }
  if (!path.includes("/chat") && !path.includes("/message")) return "other";
  if (/\/messages(\/|$)/.test(path) || /\/\d+$/.test(path)) return "messages";
  return "list";
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
  return dedupe(rows, (row) => row.threadKey).slice(0, 40);
}

export function parseChatMessages(value: unknown, threadKey: string, fanKey: string | null): ChatMessage[] {
  const rows: ChatMessage[] = [];
  walk(value, 0, (record) => {
    const message = messageFrom(record, threadKey, fanKey);
    if (message) rows.push(message);
  });
  return dedupe(rows, (row) => row.messageKey).slice(0, 50);
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

export function chatFailureReason(input: { redirected: boolean; sawUrl: boolean; parsed: boolean; jsonPaths: string[] }): string | null {
  if (input.redirected) return withPaths("redirigido a login", input.jsonPaths);
  if (input.parsed) return null;
  if (input.sawUrl) return withPaths("página cambiada (chats)", input.jsonPaths);
  return withPaths("sin respuesta de chats", input.jsonPaths);
}

function threadFrom(record: Record<string, unknown>): ChatThread | null {
  const user = nested(record.withUser) ?? nested(record.fan) ?? record;
  const last = nested(record.lastMessage) ?? nested(record.last_message);
  const threadKey = clean(record.id, 40) ?? clean(record.threadId, 40);
  const fanKey = clean(user.id, 40);
  const fanHandle = handle(user.username ?? user.handle);
  const fanName = clean(user.name, 80);
  if (!threadKey || (!fanKey && !fanHandle && !fanName)) return null;
  const excerpt = excerptOf(clean(last?.text, 500) ?? clean(last?.body, 500) ?? clean(record.excerpt, 500));
  return {
    threadKey,
    fanKey,
    fanHandle,
    fanName,
    lastMessageAt: iso(last?.createdAt ?? last?.created_at ?? record.at),
    excerpt,
    unread: count(record.unreadMessagesCount ?? record.unread),
  };
}

function messageFrom(record: Record<string, unknown>, threadKey: string, fanKey: string | null): ChatMessage | null {
  const body = clean(record.text, 2000) ?? clean(record.body, 2000);
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
  };
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
    for (const item of value.slice(0, 80)) {
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

function dedupe<T>(rows: T[], key: (row: T) => string): T[] {
  const map = new Map<string, T>();
  for (const row of rows) map.set(key(row), row);
  return [...map.values()];
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
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function count(value: unknown): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number) || number < 0) return 0;
  return Math.min(999, Math.trunc(number));
}

function withPaths(reason: string, paths: string[]): string {
  const safe = [...new Set(paths)].filter((path) => !path.includes("?") && !SECRET.test(path)).slice(0, 8);
  const text = safe.length ? `${reason}. json: ${safe.join(", ")}` : reason;
  return text.slice(0, 400);
}
