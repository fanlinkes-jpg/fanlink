import { parseWrittenMessage, type ChatMessage } from "./chats.ts";
import type { ReadSql } from "./store.ts";

export type PurchasePage = { status: number; body: unknown; retryAfterMs: number };

export type PurchaseRef = { threadId: string | null; messageId: string | null };

export function parseMessageRef(value: string | null | undefined): PurchaseRef {
  const threadId = /(?:^|\/)t:(\d{1,18})(?:\/|$)/.exec(value ?? "")?.[1] ?? null;
  const messageId = /(?:^|\/)m:(\d{1,18})(?:\/|$)/.exec(value ?? "")?.[1] ?? null;
  return { threadId, messageId };
}

export function purchaseMessagePath(fanId: string, messageId: string): string {
  return `/api2/v2/chats/${fanId}/messages?firstId=${messageId}&order=desc&limit=1`;
}

export function queueMessagePath(queueId: string): string {
  return `/api2/v2/messages/queue/${queueId}`;
}

export function queueIdOf(record: Record<string, unknown> | null): string | null {
  if (!record) return null;
  const raw = record.queueId ?? record.queue_id;
  if (typeof raw === "number" && Number.isFinite(raw)) return String(Math.trunc(raw));
  if (typeof raw === "string" && /^\d{1,18}$/.test(raw.trim())) return raw.trim();
  if (record.isFromQueue === true) {
    const id = record.id;
    if (typeof id === "number" && Number.isFinite(id)) return String(Math.trunc(id));
    if (typeof id === "string" && /^\d{1,18}$/.test(id.trim())) return id.trim();
  }
  return null;
}

/**
 * Primero el hilo. Si el mensaje es de la cola, la segunda ruta.
 * Un 429 no sigue: hay que esperar.
 */
export async function fetchPurchaseMessage(input: {
  fanId: string;
  messageId: string;
  threadKey: string;
  accountUserId: string | null;
  request: (path: string) => Promise<PurchasePage>;
}): Promise<{ message: ChatMessage | null; retryAfterMs: number }> {
  const first = await input.request(purchaseMessagePath(input.fanId, input.messageId));
  if (first.status === 429 || first.retryAfterMs > 0) return { message: null, retryAfterMs: first.retryAfterMs || 1_500 };
  const parsed = messagesOf(first.body, input.threadKey, input.fanId, input.accountUserId);
  const hit = parsed.find((message) => message.messageKey === input.messageId) ?? parsed[0] ?? null;
  const queueId = queueIdOf(recordOf(first.body, input.messageId));
  if (!queueId) return { message: hit ? { ...hit, purchased: true } : null, retryAfterMs: 0 };
  const second = await input.request(queueMessagePath(queueId));
  if (second.status === 429 || second.retryAfterMs > 0) {
    return { message: hit ? { ...hit, purchased: true } : null, retryAfterMs: second.retryAfterMs || 1_500 };
  }
  const queued = messagesOf(second.body, input.threadKey, input.fanId, input.accountUserId);
  const chosen = queued.find((message) => message.messageKey === input.messageId) ?? queued[0] ?? hit;
  return { message: chosen ? { ...chosen, purchased: true } : null, retryAfterMs: 0 };
}

function mediaFromJson(raw: string | null): ChatMessage["media"] {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    return parsed.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const row = item as Record<string, unknown>;
      const kind = row.kind === "foto" || row.kind === "video" || row.kind === "audio" ? row.kind : null;
      const seconds = typeof row.seconds === "number" && Number.isFinite(row.seconds) ? Math.round(row.seconds) : null;
      return [{
        kind,
        seconds,
        preview: typeof row.preview === "string" ? row.preview : null,
        full: typeof row.full === "string" ? row.full : null,
        locked: typeof row.locked === "boolean" ? row.locked : null,
        priceCents: typeof row.priceCents === "number" ? row.priceCents : null,
        paid: typeof row.paid === "boolean" ? row.paid : null,
        opened: typeof row.opened === "boolean" ? row.opened : null,
      }];
    });
  } catch {
    return null;
  }
}

function messagesOf(body: unknown, threadKey: string, fanKey: string, accountUserId: string | null): ChatMessage[] {
  return parseWrittenMessage(body, threadKey, fanKey, accountUserId);
}

function recordOf(body: unknown, messageId: string): Record<string, unknown> | null {
  const list = listOf(body);
  const hit = list.find((row) => String(row.id ?? "") === messageId);
  return hit ?? list[0] ?? (body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : null);
}

function listOf(body: unknown): Record<string, unknown>[] {
  if (!body || typeof body !== "object") return [];
  if (Array.isArray(body)) return body.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item));
  const record = body as Record<string, unknown>;
  const list = record.list ?? record.items ?? record.messages;
  return Array.isArray(list) ? listOf(list) : [];
}

export async function readMirroredPurchase(sql: ReadSql, creatorId: string, messageId: string): Promise<ChatMessage | null> {
  const rows = await sql.query<{
    message_key: string;
    thread_key: string;
    fan_key: string | null;
    from_fan: boolean | string;
    body: string;
    sent_at: Date | string;
    price_cents: number | string | null;
    purchased: boolean | string | null;
    media_count: number | string | null;
    media_seconds: number | string | null;
    media_preview: string | null;
    media_json: string | null;
  }>(
    `select message_key, thread_key, fan_key, from_fan, body, sent_at, price_cents, purchased,
            media_count, media_seconds, media_preview, media_json
     from of_chat_message where creator_id = $1 and message_key = $2`,
    [creatorId, messageId],
  );
  const row = rows[0];
  if (!row) return null;
  const sentAt = row.sent_at instanceof Date ? row.sent_at.toISOString() : String(row.sent_at);
  return {
    messageKey: row.message_key,
    threadKey: row.thread_key,
    fanKey: row.fan_key,
    fromFan: row.from_fan === true || row.from_fan === "t" || row.from_fan === "true",
    fromUserId: null,
    body: row.body,
    sentAt,
    priceCents: row.price_cents == null ? null : Number(row.price_cents),
    purchased: true,
    seen: null,
    automatic: null,
    mediaCount: row.media_count == null ? null : Number(row.media_count),
    mediaSeconds: row.media_seconds == null ? null : Number(row.media_seconds),
    mediaPreview: row.media_preview,
    media: mediaFromJson(row.media_json),
    liked: null,
    replyBody: null,
    eventKind: null,
    eventCents: null,
  };
}

export async function savePurchasedMessage(sql: ReadSql, creatorId: string, message: ChatMessage): Promise<void> {
  const now = new Date().toISOString();
  await sql.query(
    `insert into of_chat_thread (creator_id, thread_key, fan_key, synced_at, origin)
     values ($1, $2, $3, $4, 'onlyfans')
     on conflict (creator_id, thread_key) do update set
       fan_key = coalesce(of_chat_thread.fan_key, excluded.fan_key)`,
    [creatorId, message.threadKey, message.fanKey ?? message.threadKey, now],
  );
  await sql.query(
    `insert into of_chat_message (
       creator_id, message_key, thread_key, fan_key, from_fan, body, sent_at, price_cents, purchased, synced_at, origin,
       media_count, media_seconds, media_preview, media_json
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, true, $9, 'onlyfans', $10, $11, $12, $13)
     on conflict (creator_id, message_key) do update set
       body = excluded.body,
       price_cents = coalesce(excluded.price_cents, of_chat_message.price_cents),
       purchased = true,
       media_count = coalesce(excluded.media_count, of_chat_message.media_count),
       media_seconds = coalesce(excluded.media_seconds, of_chat_message.media_seconds),
       media_preview = coalesce(excluded.media_preview, of_chat_message.media_preview),
       media_json = coalesce(excluded.media_json, of_chat_message.media_json),
       synced_at = excluded.synced_at`,
    [
      creatorId,
      message.messageKey,
      message.threadKey,
      message.fanKey,
      message.fromFan,
      message.body || " ",
      message.sentAt,
      message.priceCents,
      now,
      message.mediaCount ?? message.media?.length ?? null,
      message.mediaSeconds ?? null,
      message.mediaPreview ?? null,
      message.media?.length ? JSON.stringify(message.media) : null,
    ],
  );
}
