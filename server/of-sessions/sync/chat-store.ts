import { newFanEvents, type ChatMessage, type ChatThread, type FanMessageEvent } from "./chats.ts";
import type { ReadSql } from "./store.ts";

const ORIGIN = "onlyfans";

export type StoredThread = ChatThread & { creatorId: string; syncedAt: string };
export type StoredChatMessage = ChatMessage & { creatorId: string; syncedAt: string };
export type ChatMeta = {
  creatorId: string;
  consecutiveFailures: number;
  lastAttemptAt: string | null;
  syncedAt: string | null;
  status: "idle" | "ok" | "error";
  reason: string | null;
};

export async function saveChatRead(
  sql: ReadSql,
  creatorId: string,
  read: { threads: ChatThread[]; messages: ChatMessage[]; reason: string | null; jsonPaths: string[] },
  now = new Date(),
): Promise<FanMessageEvent[]> {
  const syncedAt = now.toISOString();
  const known = await sql.query<{ message_key: string }>(
    "select message_key from of_chat_message where creator_id = $1",
    [creatorId],
  );
  const names = new Map(read.threads.map((thread) => [thread.fanKey ?? "", thread.fanName]));
  const events = newFanEvents(creatorId, new Set(known.map((row) => row.message_key)), read.messages, names);
  const failed = Boolean(clean(read.reason));
  const previous = await sql.query<{ chat_failures: number | string | null }>(
    "select chat_failures from of_sync_state where creator_id = $1",
    [creatorId],
  );
  const failures = failed ? Number(previous[0]?.chat_failures ?? 0) + 1 : 0;
  await sql.query("begin");
  try {
    for (const thread of read.threads) {
      await sql.query(
        `insert into of_chat_thread (
           creator_id, thread_key, fan_key, fan_handle, fan_name, last_message_at, excerpt, unread, synced_at, origin
         ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         on conflict (creator_id, thread_key) do update set
           fan_key = excluded.fan_key,
           fan_handle = excluded.fan_handle,
           fan_name = excluded.fan_name,
           last_message_at = excluded.last_message_at,
           excerpt = excluded.excerpt,
           unread = excluded.unread,
           synced_at = excluded.synced_at`,
        [
          creatorId,
          thread.threadKey,
          thread.fanKey,
          thread.fanHandle,
          thread.fanName,
          thread.lastMessageAt,
          thread.excerpt,
          thread.unread,
          syncedAt,
          ORIGIN,
        ],
      );
    }
    for (const message of read.messages) {
      await sql.query(
        `insert into of_chat_message (
           creator_id, message_key, thread_key, fan_key, from_fan, body, sent_at, price_cents, purchased, synced_at, origin
         ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         on conflict (creator_id, message_key) do update set
           body = excluded.body,
           from_fan = excluded.from_fan,
           sent_at = excluded.sent_at,
           price_cents = excluded.price_cents,
           purchased = excluded.purchased,
           synced_at = excluded.synced_at`,
        [
          creatorId,
          message.messageKey,
          message.threadKey,
          message.fanKey,
          message.fromFan,
          message.body,
          message.sentAt,
          message.priceCents,
          message.purchased,
          syncedAt,
          ORIGIN,
        ],
      );
    }
    for (const event of events) {
      await sql.query(
        `insert into of_fan_message_event (id, creator_id, fan_key, fan_name, excerpt, sent_at)
         values ($1, $2, $3, $4, $5, $6)
         on conflict (id) do nothing`,
        [event.id, event.creatorId, event.fanKey, event.fanName, event.excerpt, event.sentAt],
      );
    }
    await sql.query(
      `insert into of_sync_state (
         creator_id, origin, chat_synced_at, chat_last_attempt_at, chat_failures, chat_status, chat_reason
       ) values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (creator_id) do update set
         chat_synced_at = case when $6 = 'ok' then excluded.chat_synced_at else of_sync_state.chat_synced_at end,
         chat_last_attempt_at = excluded.chat_last_attempt_at,
         chat_failures = excluded.chat_failures,
         chat_status = excluded.chat_status,
         chat_reason = excluded.chat_reason`,
      [creatorId, ORIGIN, syncedAt, syncedAt, failures, failed ? "error" : "ok", clean(read.reason)],
    );
    await sql.query("commit");
  } catch (error) {
    await sql.query("rollback").catch(() => undefined);
    throw error;
  }
  for (const event of events) {
    console.info(
      `[fanlink:chat] new_fan_message creator=${event.creatorId} fan=${event.fanName ?? event.fanKey ?? "fan"} at=${event.sentAt} excerpt=${event.excerpt}`,
    );
  }
  return events;
}

export async function listChats(
  sql: ReadSql,
  creatorIds: string[],
): Promise<{ threads: StoredThread[]; messages: StoredChatMessage[]; meta: ChatMeta[] }> {
  if (!creatorIds.length) return { threads: [], messages: [], meta: [] };
  const filter = creatorIds.map((_, index) => `$${index + 1}`).join(", ");
  const threads = await sql.query<ThreadRow>(
    `select creator_id, thread_key, fan_key, fan_handle, fan_name, last_message_at, excerpt, unread, synced_at
     from of_chat_thread where creator_id in (${filter})
     order by last_message_at desc nulls last`,
    creatorIds,
  );
  const messages = await sql.query<MessageRow>(
    `select creator_id, message_key, thread_key, fan_key, from_fan, body, sent_at, price_cents, purchased, synced_at
     from of_chat_message where creator_id in (${filter})
     order by sent_at`,
    creatorIds,
  );
  const meta = await sql.query<MetaRow>(
    `select creator_id, chat_failures, chat_last_attempt_at, chat_synced_at, chat_status, chat_reason
     from of_sync_state where creator_id in (${filter})`,
    creatorIds,
  );
  return {
    threads: threads.map((row) => ({
      creatorId: row.creator_id,
      threadKey: row.thread_key,
      fanKey: row.fan_key,
      fanHandle: row.fan_handle,
      fanName: row.fan_name,
      lastMessageAt: iso(row.last_message_at),
      excerpt: row.excerpt,
      unread: Number(row.unread ?? 0),
      syncedAt: iso(row.synced_at) ?? "",
    })),
    messages: messages.map((row) => ({
      creatorId: row.creator_id,
      messageKey: row.message_key,
      threadKey: row.thread_key,
      fanKey: row.fan_key,
      fromFan: row.from_fan === true || row.from_fan === "t" || row.from_fan === "true",
      body: row.body,
      sentAt: iso(row.sent_at) ?? "",
      priceCents: row.price_cents == null ? null : Number(row.price_cents),
      purchased: row.purchased == null ? null : row.purchased === true || row.purchased === "t" || row.purchased === "true",
      syncedAt: iso(row.synced_at) ?? "",
    })),
    meta: meta.map((row) => ({
      creatorId: row.creator_id,
      consecutiveFailures: Number(row.chat_failures ?? 0),
      lastAttemptAt: iso(row.chat_last_attempt_at),
      syncedAt: iso(row.chat_synced_at),
      status: row.chat_status === "ok" || row.chat_status === "error" ? row.chat_status : "idle",
      reason: row.chat_reason,
    })),
  };
}

export async function listChatMeta(sql: ReadSql): Promise<ChatMeta[]> {
  const rows = await sql.query<MetaRow>(
    "select creator_id, chat_failures, chat_last_attempt_at, chat_synced_at, chat_status, chat_reason from of_sync_state",
  );
  return rows.map((row) => ({
    creatorId: row.creator_id,
    consecutiveFailures: Number(row.chat_failures ?? 0),
    lastAttemptAt: iso(row.chat_last_attempt_at),
    syncedAt: iso(row.chat_synced_at),
    status: row.chat_status === "ok" || row.chat_status === "error" ? row.chat_status : "idle",
    reason: row.chat_reason,
  }));
}

type ThreadRow = {
  creator_id: string;
  thread_key: string;
  fan_key: string | null;
  fan_handle: string | null;
  fan_name: string | null;
  last_message_at: Date | string | null;
  excerpt: string | null;
  unread: number | string | null;
  synced_at: Date | string;
};

type MessageRow = {
  creator_id: string;
  message_key: string;
  thread_key: string;
  fan_key: string | null;
  from_fan: boolean | string;
  body: string;
  sent_at: Date | string;
  price_cents: number | string | null;
  purchased: boolean | string | null;
  synced_at: Date | string;
};

type MetaRow = {
  creator_id: string;
  chat_failures: number | string | null;
  chat_last_attempt_at: Date | string | null;
  chat_synced_at: Date | string | null;
  chat_status: string | null;
  chat_reason: string | null;
};

function iso(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toISOString();
}

function clean(value: string | null): string | null {
  if (!value) return null;
  const text = value.replace(/\s+/g, " ").trim();
  if (!text || /cookie|set-cookie|authorization|password/i.test(text)) return "no se pudo leer";
  return text.slice(0, 400);
}
