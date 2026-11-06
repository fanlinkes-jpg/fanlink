import { matchOutboundAuthor, type OutboundDraft } from "./author-match.ts";
import { newFanEvents, type ChatMessage, type ChatThread, type FanMessageEvent } from "./chats.ts";
import { decodeMedia, encodeMedia, oldestCursor } from "./history.ts";
import type { ReadSql } from "./store.ts";

const ORIGIN = "onlyfans";

export type StoredThread = ChatThread & { creatorId: string; syncedAt: string };
export type StoredChatMessage = ChatMessage & {
  creatorId: string;
  syncedAt: string;
  authorId: string | null;
  authorName: string | null;
};
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
           creator_id, thread_key, fan_key, fan_handle, fan_name, last_message_at, excerpt, unread, synced_at, origin,
           last_from_fan, spent_cents, subscribes_cents, tips_cents, posts_cents, messages_cents,
           avatar_url, is_online, sub_price_cents, sub_expires_at, renew_auto, fan_lists
         ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
         on conflict (creator_id, thread_key) do update set
           fan_key = excluded.fan_key,
           fan_handle = excluded.fan_handle,
           fan_name = excluded.fan_name,
           last_message_at = excluded.last_message_at,
           excerpt = excluded.excerpt,
           unread = excluded.unread,
           synced_at = excluded.synced_at,
           last_from_fan = excluded.last_from_fan,
           spent_cents = excluded.spent_cents,
           subscribes_cents = excluded.subscribes_cents,
           tips_cents = excluded.tips_cents,
           posts_cents = excluded.posts_cents,
           messages_cents = excluded.messages_cents,
           avatar_url = excluded.avatar_url,
           is_online = excluded.is_online,
           sub_price_cents = excluded.sub_price_cents,
           sub_expires_at = excluded.sub_expires_at,
           renew_auto = excluded.renew_auto,
           fan_lists = excluded.fan_lists`,
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
          thread.lastFromFan,
          thread.spentCents,
          thread.subscribesCents,
          thread.tipsCents,
          thread.postsCents,
          thread.messagesCents,
          thread.avatarUrl,
          thread.online,
          thread.subPriceCents,
          thread.subExpiresAt,
          thread.renewAuto,
          thread.lists?.length ? thread.lists.join("\n") : null,
        ],
      );
    }
    for (const message of read.messages) {
      await sql.query(
        `insert into of_chat_message (
           creator_id, message_key, thread_key, fan_key, from_fan, body, sent_at, price_cents, purchased, synced_at, origin, author_id, seen, automatic,
           media_count, media_seconds, media_preview, media_json, liked, reply_body, event_kind, event_cents
         ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, null, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
         on conflict (creator_id, message_key) do update set
           body = excluded.body,
           from_fan = excluded.from_fan,
           sent_at = excluded.sent_at,
           price_cents = excluded.price_cents,
           purchased = excluded.purchased,
           synced_at = excluded.synced_at,
           author_id = coalesce(of_chat_message.author_id, excluded.author_id),
           seen = excluded.seen,
           automatic = excluded.automatic,
           media_count = excluded.media_count,
           media_seconds = excluded.media_seconds,
           media_preview = excluded.media_preview,
           media_json = excluded.media_json,
           liked = excluded.liked,
           reply_body = excluded.reply_body,
           event_kind = excluded.event_kind,
           event_cents = excluded.event_cents`,
        [
          creatorId,
          message.messageKey,
          message.threadKey,
          message.fanKey,
          message.fromFan,
          message.body || (message.eventKind ? " " : " "),
          message.sentAt,
          message.priceCents,
          message.purchased,
          syncedAt,
          ORIGIN,
          message.seen,
          message.automatic,
          message.mediaCount ?? null,
          message.mediaSeconds ?? null,
          message.mediaPreview ?? null,
          encodeMedia(message.media),
          message.liked ?? null,
          message.replyBody ?? null,
          message.eventKind ?? null,
          message.eventCents ?? null,
        ],
      );
    }
    await attachOutboundAuthors(sql, creatorId, read.messages);
    await noteHistoryCursor(sql, creatorId);
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
    `select creator_id, thread_key, fan_key, fan_handle, fan_name, last_message_at, excerpt, unread, synced_at,
            last_from_fan, spent_cents, subscribes_cents, tips_cents, posts_cents, messages_cents,
            avatar_url, is_online, sub_price_cents, sub_expires_at, renew_auto, fan_lists
     from of_chat_thread where creator_id in (${filter})
     order by last_message_at desc nulls last`,
    creatorIds,
  );
  const messages = await sql.query<MessageRow>(
    `select m.creator_id, m.message_key, m.thread_key, m.fan_key, m.from_fan, m.body, m.sent_at, m.price_cents, m.purchased, m.synced_at,
            m.author_id, p.display_name as author_name, m.seen, m.automatic, m.media_count, m.media_seconds, m.media_preview,
            m.media_json, m.liked, m.reply_body, m.event_kind, m.event_cents
     from of_chat_message m
     left join staff_profile p on p.user_id = m.author_id
     where m.creator_id in (${filter})
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
      lastFromUserId: null,
      lastFromFan: flagOrNull(row.last_from_fan),
      spentCents: centsOrNull(row.spent_cents),
      subscribesCents: centsOrNull(row.subscribes_cents),
      tipsCents: centsOrNull(row.tips_cents),
      postsCents: centsOrNull(row.posts_cents),
      messagesCents: centsOrNull(row.messages_cents),
      avatarUrl: row.avatar_url,
      online: flagOrNull(row.is_online),
      subPriceCents: centsOrNull(row.sub_price_cents),
      subExpiresAt: iso(row.sub_expires_at),
      renewAuto: flagOrNull(row.renew_auto),
      lists: row.fan_lists ? row.fan_lists.split("\n").filter(Boolean) : null,
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
      fromUserId: null,
      authorId: row.author_id,
      authorName: row.author_name,
      seen: flagOrNull(row.seen),
      automatic: flagOrNull(row.automatic),
      mediaCount: row.media_count == null ? null : Number(row.media_count),
      mediaSeconds: row.media_seconds == null ? null : Number(row.media_seconds),
      mediaPreview: row.media_preview,
      media: decodeMedia(row.media_json),
      liked: flagOrNull(row.liked),
      replyBody: row.reply_body,
      eventKind: row.event_kind === "compra" || row.event_kind === "propina" ? row.event_kind : null,
      eventCents: row.event_cents == null ? null : Number(row.event_cents),
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
  last_from_fan: boolean | string | null;
  spent_cents: number | string | null;
  subscribes_cents: number | string | null;
  tips_cents: number | string | null;
  posts_cents: number | string | null;
  messages_cents: number | string | null;
  avatar_url: string | null;
  is_online: boolean | string | null;
  sub_price_cents: number | string | null;
  sub_expires_at: Date | string | null;
  renew_auto: boolean | string | null;
  fan_lists: string | null;
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
  author_id: string | null;
  author_name: string | null;
  seen: boolean | string | null;
  automatic: boolean | string | null;
  media_count: number | string | null;
  media_seconds: number | string | null;
  media_preview: string | null;
  media_json: string | null;
  liked: boolean | string | null;
  reply_body: string | null;
  event_kind: string | null;
  event_cents: number | string | null;
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

/** Si la sincronización ya pasó por ese momento y el mensaje no está, no se envió. */
export function outboundStillMissing(
  draft: { createdAt: string; errorReason: string | null; scheduledAt: string | null },
  messages: ReadonlyArray<{ sentAt: string }>,
): boolean {
  if (draft.errorReason !== "Pendiente de confirmar" || draft.scheduledAt) return false;
  const created = Date.parse(draft.createdAt);
  if (!Number.isFinite(created)) return false;
  return messages.some((message) => {
    const sent = Date.parse(message.sentAt);
    return Number.isFinite(sent) && sent >= created - 15_000;
  });
}

async function attachOutboundAuthors(sql: ReadSql, creatorId: string, messages: ChatMessage[]): Promise<void> {
  const drafts = await sql.query<{
    id: string;
    author_id: string;
    body: string;
    price_cents: number | string | null;
    created_at: Date | string;
    thread_key: string | null;
    fan_key: string | null;
    of_message_key: string | null;
    error_reason: string | null;
    scheduled_at: Date | string | null;
  }>(
    `select id, author_id, body, price_cents, created_at, thread_key, fan_key, of_message_key, error_reason, scheduled_at
     from of_chat_outbound where creator_id = $1 and matched_message_key is null`,
    [creatorId],
  );
  const pending: OutboundDraft[] = drafts.map((row) => ({
    id: row.id,
    authorId: row.author_id,
    body: row.body,
    priceCents: row.price_cents == null ? null : Number(row.price_cents),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    threadKey: row.thread_key,
    fanKey: row.fan_key,
    ofMessageKey: row.of_message_key,
  }));
  const used = new Set<string>();
  for (const message of messages) {
    const match = matchOutboundAuthor(message, pending.filter((draft) => !used.has(draft.id)));
    if (!match) continue;
    used.add(match.draftId);
    await sql.query(
      `update of_chat_message set author_id = $1
       where creator_id = $2 and message_key = $3 and author_id is null`,
      [match.authorId, creatorId, message.messageKey],
    );
    await sql.query(
      `update of_chat_outbound set matched_message_key = $2, status = 'sent', error_reason = null where id = $1`,
      [match.draftId, message.messageKey],
    );
  }
  for (const row of drafts) {
    if (used.has(row.id)) continue;
    const createdAt = row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at);
    const scheduledAt = row.scheduled_at == null ? null : row.scheduled_at instanceof Date ? row.scheduled_at.toISOString() : String(row.scheduled_at);
    if (!outboundStillMissing({ createdAt, errorReason: row.error_reason, scheduledAt }, messages)) continue;
    await markOutboundError(sql, row.id, "no enviado");
  }
}

export async function listPendingOutbounds(
  sql: ReadSql,
  creatorIds: string[],
): Promise<Array<{ id: string; creatorId: string; threadKey: string | null; body: string; scheduledAt: string | null; authorName: string | null; status: "pending" | "error"; errorReason: string | null }>> {
  if (!creatorIds.length) return [];
  const filter = creatorIds.map((_, index) => `$${index + 1}`).join(", ");
  const rows = await sql.query<{ id: string; creator_id: string; thread_key: string | null; body: string; scheduled_at: Date | string | null; author_name: string | null; status: string | null; error_reason: string | null }>(
    `select o.id, o.creator_id, o.thread_key, o.body, o.scheduled_at, p.display_name as author_name, o.status, o.error_reason
     from of_chat_outbound o
     left join staff_profile p on p.user_id = o.author_id
     where o.creator_id in (${filter}) and o.matched_message_key is null and coalesce(o.status, 'pending') <> 'sent'
     order by o.created_at`,
    creatorIds,
  );
  return rows.map((row) => ({
    id: row.id,
    creatorId: row.creator_id,
    threadKey: row.thread_key,
    body: row.body,
    scheduledAt: row.scheduled_at == null ? null : row.scheduled_at instanceof Date ? row.scheduled_at.toISOString() : String(row.scheduled_at),
    authorName: row.author_name,
    status: row.status === "error" ? "error" : "pending",
    errorReason: row.error_reason,
  }));
}

export async function markOutboundSent(sql: ReadSql, id: string, messageId: string): Promise<void> {
  await sql.query(
    `update of_chat_outbound
     set status = 'sent', of_message_key = $2, sent_at = now(), error_reason = null
     where id = $1 and coalesce(status, 'pending') <> 'sent'`,
    [id, messageId],
  );
}

export async function markOutboundAwaiting(sql: ReadSql, id: string): Promise<void> {
  await sql.query(
    `update of_chat_outbound
     set status = 'pending', of_message_key = null, error_reason = 'Pendiente de confirmar'
     where id = $1 and coalesce(status, 'pending') <> 'sent'`,
    [id],
  );
}

export async function markOutboundError(sql: ReadSql, id: string, reason: string): Promise<void> {
  await sql.query(
    `update of_chat_outbound
     set status = 'error', error_reason = $2
     where id = $1 and coalesce(status, 'pending') = 'pending'`,
    [id, reason.slice(0, 180)],
  );
}

export async function noteHistoryCursor(sql: ReadSql, creatorId: string): Promise<void> {
  await sql.query(
    `update of_chat_thread t set history_cursor = sub.message_key
     from (
       select distinct on (thread_key) thread_key, message_key
       from of_chat_message
       where creator_id = $1
       order by thread_key, sent_at asc
     ) sub
     where t.creator_id = $1 and t.thread_key = sub.thread_key and t.history_cursor is null`,
    [creatorId],
  );
}

export async function listOpenHistory(sql: ReadSql, creatorId: string): Promise<Array<{ threadKey: string; cursor: string | null; done: boolean }>> {
  const rows = await sql.query<{ thread_key: string; history_cursor: string | null; history_done: boolean | string }>(
    `select thread_key, history_cursor, history_done from of_chat_thread
     where creator_id = $1 and history_done = false
     order by last_message_at desc nulls last`,
    [creatorId],
  );
  return rows.map((row) => ({
    threadKey: row.thread_key,
    cursor: row.history_cursor,
    done: row.history_done === true || row.history_done === "t" || row.history_done === "true",
  }));
}

export async function markHistory(sql: ReadSql, creatorId: string, threadKey: string, cursor: string | null, done: boolean): Promise<void> {
  await sql.query(
    `update of_chat_thread set history_cursor = coalesce($3, history_cursor), history_done = $4
     where creator_id = $1 and thread_key = $2`,
    [creatorId, threadKey, cursor, done],
  );
}

export async function markChatList(sql: ReadSql, creatorId: string, cursor: string | null, done: boolean): Promise<void> {
  await sql.query(
    `insert into of_sync_state (creator_id, origin, chat_list_cursor, chat_list_done)
     values ($1, $2, $3, $4)
     on conflict (creator_id) do update set chat_list_cursor = excluded.chat_list_cursor, chat_list_done = excluded.chat_list_done`,
    [creatorId, ORIGIN, cursor, done],
  );
}

export async function recordOutbound(sql: ReadSql, draft: OutboundDraft & { creatorId: string }): Promise<void> {
  await sql.query(
    `insert into of_chat_outbound (id, creator_id, thread_key, fan_key, author_id, body, price_cents, created_at, of_message_key, scheduled_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [draft.id, draft.creatorId, draft.threadKey, draft.fanKey, draft.authorId, draft.body, draft.priceCents, draft.createdAt, draft.ofMessageKey, draft.scheduledAt ?? null],
  );
}

function flagOrNull(value: boolean | string | null): boolean | null {
  if (value == null) return null;
  if (value === true || value === "t" || value === "true") return true;
  if (value === false || value === "f" || value === "false") return false;
  return null;
}

function centsOrNull(value: number | string | null): number | null {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clean(value: string | null): string | null {
  if (!value) return null;
  const text = value.replace(/\s+/g, " ").trim();
  if (!text || /cookie|set-cookie|authorization|password/i.test(text)) return "no se pudo leer";
  return text.slice(0, 400);
}
