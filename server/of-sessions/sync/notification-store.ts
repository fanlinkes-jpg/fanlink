import type { ParsedNotification, NotificationRecord } from "../../../src/lib/notifications.ts";

export type NotificationSql = {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

export type NotificationSyncMeta = {
  creatorId: string;
  consecutiveFailures: number;
  lastAttemptAt: string | null;
};

const ORIGIN = "onlyfans";

export async function saveNotificationRead(
  sql: NotificationSql,
  creatorId: string,
  read: { items: ParsedNotification[]; reason: string | null; captured: boolean },
  now = new Date(),
): Promise<void> {
  const syncedAt = now.toISOString();
  const failed = !read.captured && Boolean(read.reason);
  await sql.query(
    `insert into of_notification_sync (creator_id, last_attempt_at, consecutive_failures, last_status, last_reason)
     values ($1, $2, $3, $4, $5)
     on conflict (creator_id) do update set
       last_attempt_at = excluded.last_attempt_at,
       consecutive_failures = case when $4 = 'ok' then 0 else of_notification_sync.consecutive_failures + 1 end,
       last_status = excluded.last_status,
       last_reason = excluded.last_reason`,
    [creatorId, syncedAt, failed ? 1 : 0, failed ? "error" : "ok", read.reason],
  );
  for (const item of read.items) {
    await sql.query(
      `insert into of_notification (
         creator_id, notification_key, kind, body, fan_key, fan_name, thread_key,
         amount_cents, occurred_at, pending, synced_at, origin
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       on conflict (creator_id, notification_key) do update set
         kind = excluded.kind,
         body = coalesce(excluded.body, of_notification.body),
         fan_key = coalesce(excluded.fan_key, of_notification.fan_key),
         fan_name = coalesce(excluded.fan_name, of_notification.fan_name),
         thread_key = coalesce(excluded.thread_key, of_notification.thread_key),
         amount_cents = coalesce(excluded.amount_cents, of_notification.amount_cents),
         occurred_at = coalesce(excluded.occurred_at, of_notification.occurred_at),
         pending = of_notification.pending or excluded.pending,
         synced_at = excluded.synced_at`,
      [
        creatorId,
        item.key,
        item.kind,
        item.body,
        item.fanKey,
        item.fanName,
        item.threadKey,
        item.amountCents,
        item.occurredAt,
        item.pending,
        syncedAt,
        ORIGIN,
      ],
    );
  }
}

export async function listNotificationRows(sql: NotificationSql, creatorId: string): Promise<NotificationRecord[]> {
  const rows = await sql.query<{
    notification_key: string;
    kind: string;
    body: string | null;
    fan_key: string | null;
    fan_name: string | null;
    thread_key: string | null;
    amount_cents: number | string | null;
    occurred_at: Date | string | null;
    pending: boolean | string;
    seen_at: Date | string | null;
  }>(
    `select notification_key, kind, body, fan_key, fan_name, thread_key, amount_cents, occurred_at, pending, seen_at
     from of_notification where creator_id = $1`,
    [creatorId],
  );
  return rows.flatMap((row) => {
    const kind = asKind(row.kind);
    if (!kind) return [];
    return [
      {
        creatorId,
        key: row.notification_key,
        kind,
        body: row.body,
        fanKey: row.fan_key,
        fanName: row.fan_name,
        threadKey: row.thread_key,
        amountCents: row.amount_cents == null ? null : Number(row.amount_cents),
        occurredAt: asIso(row.occurred_at),
        pending: row.pending === true || row.pending === "t" || row.pending === "true",
        seenAt: asIso(row.seen_at),
      },
    ];
  });
}

export async function notificationSyncedAt(sql: NotificationSql, creatorId: string): Promise<string | null> {
  const rows = await sql.query<{ last_attempt_at: Date | string | null; last_status: string }>(
    "select last_attempt_at, last_status from of_notification_sync where creator_id = $1",
    [creatorId],
  );
  const row = rows[0];
  if (!row || row.last_status !== "ok") return null;
  return asIso(row.last_attempt_at);
}

export async function listNotificationMeta(sql: NotificationSql): Promise<NotificationSyncMeta[]> {
  const rows = await sql.query<{ creator_id: string; consecutive_failures: number | string; last_attempt_at: Date | string | null }>(
    "select creator_id, consecutive_failures, last_attempt_at from of_notification_sync",
  );
  return rows.map((row) => ({
    creatorId: row.creator_id,
    consecutiveFailures: Number(row.consecutive_failures) || 0,
    lastAttemptAt: asIso(row.last_attempt_at),
  }));
}

export async function markNotificationsSeen(
  sql: NotificationSql,
  creatorId: string,
  keys: string[] | null,
  now = new Date(),
): Promise<number> {
  const seenAt = now.toISOString();
  if (keys == null) {
    const rows = await sql.query<{ notification_key: string }>(
      "update of_notification set seen_at = $2 where creator_id = $1 and seen_at is null returning notification_key",
      [creatorId, seenAt],
    );
    return rows.length;
  }
  const clean = [...new Set(keys.map((key) => key.trim()).filter(Boolean))].slice(0, 200);
  if (clean.length === 0) return 0;
  const rows = await sql.query<{ notification_key: string }>(
    "update of_notification set seen_at = $3 where creator_id = $1 and notification_key = any($2::text[]) and seen_at is null returning notification_key",
    [creatorId, clean, seenAt],
  );
  return rows.length;
}

function asIso(value: Date | string | null): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

function asKind(value: string): NotificationRecord["kind"] | null {
  switch (value) {
    case "like":
    case "comment":
    case "tag":
    case "subscription":
    case "renewal":
    case "tip":
    case "ppv":
    case "message":
    case "system":
    case "other":
      return value;
    default:
      return null;
  }
}
