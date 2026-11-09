import { WorkspaceAccessError } from "../../../src/lib/access-policy.ts";
import {
  canReadCreatorNotifications,
  chatterVisibleKinds,
  decodeNotificationCursor,
  encodeNotificationCursor,
  isFanSpendKind,
  isOwnerOnlyKind,
  notificationLabels,
  tabOf,
  NOTIFICATION_KINDS,
  NOTIFICATION_PAGE_SIZE,
  NOTIFICATION_RETENTION_DAYS,
  type ParsedNotification,
  type NotificationRecord,
} from "../../../src/lib/notifications.ts";

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
         amount_cents, occurred_at, pending, first_seen_at, synced_at, origin
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       on conflict (creator_id, notification_key) do update set
         kind = case
           when of_notification.kind = 'other' and excluded.kind <> 'other'
           then excluded.kind
           when of_notification.kind = 'agency' and excluded.kind <> 'agency'
           then of_notification.kind
           when of_notification.kind in ('tip', 'ppv', 'subscription', 'renewal')
            and excluded.kind not in ('tip', 'ppv', 'subscription', 'renewal')
           then of_notification.kind
           else excluded.kind
         end,
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
        syncedAt,
        ORIGIN,
      ],
    );
  }
  const cutoff = new Date(now.getTime() - NOTIFICATION_RETENTION_DAYS * 86_400_000).toISOString();
  await sql.query(
    `delete from of_notification_seen
     where creator_id = $1
       and notification_key in (
         select notification_key from of_notification
         where creator_id = $1
           and (
             (occurred_at is not null and occurred_at < $2::timestamptz)
             or (occurred_at is null and first_seen_at < $2::timestamptz)
           )
       )`,
    [creatorId, cutoff],
  );
  await sql.query(
    `delete from of_notification
     where creator_id = $1
       and (
         (occurred_at is not null and occurred_at < $2::timestamptz)
         or (occurred_at is null and first_seen_at < $2::timestamptz)
       )`,
    [creatorId, cutoff],
  );
}

export type NotificationPage = {
  rows: NotificationRecord[];
  nextCursor: string | null;
};

export async function listNotificationRows(
  sql: NotificationSql,
  creatorId: string,
  userId: string,
  options: { limit?: number; cursor?: string | null; role?: "owner" | "member" } = {},
): Promise<NotificationPage> {
  const limit = Math.min(100, Math.max(1, options.limit ?? NOTIFICATION_PAGE_SIZE));
  const cursor = decodeNotificationCursor(options.cursor);
  const kinds = options.role === "member" ? chatterVisibleKinds() : [...NOTIFICATION_KINDS];
  const params: unknown[] = [creatorId, userId, kinds];
  let cursorSql = "";
  if (cursor?.at) {
    params.push(cursor.at, cursor.key);
    cursorSql = `and (
      n.occurred_at < $4::timestamptz
      or (n.occurred_at = $4::timestamptz and n.notification_key < $5)
      or n.occurred_at is null
    )`;
  } else if (cursor) {
    params.push(cursor.key);
    cursorSql = "and n.occurred_at is null and n.notification_key < $4";
  }
  params.push(limit + 1);
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
    `select n.notification_key, n.kind, n.body, n.fan_key, n.fan_name, n.thread_key,
            n.amount_cents, n.occurred_at, n.pending, s.seen_at
     from of_notification n
     left join of_notification_seen s
       on s.creator_id = n.creator_id
      and s.notification_key = n.notification_key
      and s.user_id = $2
     where n.creator_id = $1
       and n.kind = any($3::text[])
     ${cursorSql}
     order by n.occurred_at desc nulls last, n.notification_key desc
     limit $${params.length}`,
    params,
  );
  const mapped = rows.flatMap((row) => {
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
  const page = mapped.slice(0, limit);
  const last = page.at(-1);
  const nextCursor = mapped.length > limit && last ? encodeNotificationCursor({ at: last.occurredAt, key: last.key }) : null;
  return { rows: page, nextCursor };
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

export async function notificationPageFor(
  sql: NotificationSql,
  access: { userId: string; role: "owner" | "member"; creatorIds: string[] },
  creatorId: string,
  cursor?: string | null,
) {
  if (!canReadCreatorNotifications(access, creatorId)) {
    return { role: access.role, syncedAt: null as string | null, items: [] as NotificationListRow[], nextCursor: null as string | null };
  }
  const [page, syncedAt] = await Promise.all([
    listNotificationRows(sql, creatorId, access.userId, { cursor, role: access.role }),
    notificationSyncedAt(sql, creatorId),
  ]);
  return {
    role: access.role,
    syncedAt,
    nextCursor: page.nextCursor,
    items: page.rows.flatMap((row) => {
      const labels = notificationLabels(row, access.role);
      if (!labels) return [];
      return [
        {
          key: row.key,
          kind: row.kind,
          tab: tabOf(row.kind),
          body: row.body,
          fanKey: row.fanKey,
          fanName: row.fanName,
          threadKey: row.threadKey,
          amountCents: access.role === "owner" || isFanSpendKind(row.kind) ? row.amountCents : null,
          occurredAt: row.occurredAt,
          pending: row.pending,
          seen: Boolean(row.seenAt),
          labels,
        },
      ];
    }),
  };
}

export type NotificationListRow = {
  key: string;
  kind: NotificationRecord["kind"];
  tab: ReturnType<typeof tabOf>;
  body: string | null;
  fanKey: string | null;
  fanName: string | null;
  threadKey: string | null;
  amountCents: number | null;
  occurredAt: string | null;
  pending: boolean;
  seen: boolean;
  labels: NonNullable<ReturnType<typeof notificationLabels>>;
};

export async function markNotificationPage(
  sql: NotificationSql,
  access: { userId: string; role: "owner" | "member"; creatorIds: string[] },
  creatorId: string,
  keys: string[] | null,
): Promise<number> {
  if (!canReadCreatorNotifications(access, creatorId)) {
    throw new WorkspaceAccessError("No tienes esa cuenta.");
  }
  const visible = new Set(
    (await notificationKinds(sql, creatorId, keys ?? []))
      .filter((row) => access.role === "owner" || !isOwnerOnlyKind(row.kind))
      .map((row) => row.key),
  );
  return markNotificationsSeen(sql, creatorId, access.userId, (keys ?? []).filter((key) => visible.has(key)));
}

export async function notificationKinds(
  sql: NotificationSql,
  creatorId: string,
  keys: string[],
): Promise<Array<{ key: string; kind: NotificationRecord["kind"] }>> {
  const clean = [...new Set(keys.map((key) => key.trim()).filter(Boolean))].slice(0, 200);
  if (clean.length === 0) return [];
  const rows = await sql.query<{ notification_key: string; kind: string }>(
    "select notification_key, kind from of_notification where creator_id = $1 and notification_key = any($2::text[])",
    [creatorId, clean],
  );
  return rows.flatMap((row) => {
    const kind = asKind(row.kind);
    return kind ? [{ key: row.notification_key, kind }] : [];
  });
}

export async function markNotificationsSeen(
  sql: NotificationSql,
  creatorId: string,
  userId: string,
  keys: string[],
  now = new Date(),
): Promise<number> {
  const clean = [...new Set(keys.map((key) => key.trim()).filter(Boolean))].slice(0, 200);
  if (!userId || clean.length === 0) return 0;
  const rows = await sql.query<{ notification_key: string }>(
    `insert into of_notification_seen (creator_id, notification_key, user_id, seen_at)
     select n.creator_id, n.notification_key, $3, $4
     from of_notification n
     where n.creator_id = $1 and n.notification_key = any($2::text[])
     on conflict (creator_id, notification_key, user_id) do nothing
     returning notification_key`,
    [creatorId, clean, userId, now.toISOString()],
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
    case "mention":
    case "promotion":
    case "system":
    case "agency":
    case "other":
      return value;
    default:
      return null;
  }
}
