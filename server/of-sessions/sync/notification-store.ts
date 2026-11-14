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
  type NotificationCounts,
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
  read: {
    items: ParsedNotification[];
    reason: string | null;
    captured: boolean;
    counts?: NotificationCounts | null;
    status?: number | null;
    motivo?: string | null;
  },
  now = new Date(),
): Promise<void> {
  const syncedAt = now.toISOString();
  const failed = !read.captured && Boolean(read.reason || read.motivo);
  const motivo = read.motivo ?? read.reason;
  await sql.query(
    `insert into of_notification_sync (
       creator_id, last_attempt_at, consecutive_failures, last_status, last_reason, unread_counts, last_http_status
     ) values ($1, $2, $3, $4, $5, $6::jsonb, $7)
     on conflict (creator_id) do update set
       last_attempt_at = excluded.last_attempt_at,
       consecutive_failures = case when $4 = 'ok' then 0 else of_notification_sync.consecutive_failures + 1 end,
       last_status = excluded.last_status,
       last_reason = excluded.last_reason,
       unread_counts = coalesce(excluded.unread_counts, of_notification_sync.unread_counts),
       last_http_status = coalesce(excluded.last_http_status, of_notification_sync.last_http_status)`,
    [creatorId, syncedAt, failed ? 1 : 0, failed ? "error" : "ok", motivo, read.counts ? JSON.stringify(read.counts) : null, read.status ?? null],
  );
  for (const item of read.items) {
    await sql.query(
      `insert into of_notification (
         creator_id, notification_key, kind, body, fan_key, fan_name, thread_key,
         amount_cents, occurred_at, pending, first_seen_at, synced_at, origin, of_unread,
         fan_handle, avatar_url, fan_lists, renew_auto, fan_seen_at, post_ref
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
       on conflict (creator_id, notification_key) do update set
         kind = case
           when of_notification.kind in ('agency', 'other')
            and excluded.kind not in ('agency', 'other')
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
         synced_at = excluded.synced_at,
         of_unread = coalesce(excluded.of_unread, of_notification.of_unread),
         fan_handle = coalesce(excluded.fan_handle, of_notification.fan_handle),
         avatar_url = coalesce(excluded.avatar_url, of_notification.avatar_url),
         fan_lists = coalesce(excluded.fan_lists, of_notification.fan_lists),
         renew_auto = coalesce(excluded.renew_auto, of_notification.renew_auto),
         fan_seen_at = coalesce(excluded.fan_seen_at, of_notification.fan_seen_at),
         post_ref = coalesce(excluded.post_ref, of_notification.post_ref)`,
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
        item.ofUnread ?? null,
        item.fanHandle ?? null,
        item.avatarUrl ?? null,
        listsText(item.lists),
        item.renewAuto ?? null,
        item.fanSeenAt ?? null,
        item.postRef ?? null,
      ],
    );
  }
  if (read.counts?.all === 0) {
    await sql.query("update of_notification set of_unread = false where creator_id = $1", [creatorId]);
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
    of_unread: boolean | string | null;
    fan_handle: string | null;
    avatar_url: string | null;
    fan_lists: string | null;
    renew_auto: boolean | string | null;
    fan_seen_at: Date | string | null;
    post_ref: string | null;
  }>(
    `select n.notification_key, n.kind, n.body, n.fan_key, n.fan_name, n.thread_key,
            n.amount_cents, n.occurred_at, n.pending, s.seen_at, n.of_unread,
            n.fan_handle, n.avatar_url, n.fan_lists, n.renew_auto, n.fan_seen_at, n.post_ref
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
        ofUnread: row.of_unread == null ? null : row.of_unread === true || row.of_unread === "t" || row.of_unread === "true",
        fanHandle: row.fan_handle,
        avatarUrl: row.avatar_url,
        lists: listsOf(row.fan_lists),
        renewAuto: boolOrNull(row.renew_auto),
        fanSeenAt: asIso(row.fan_seen_at),
        postRef: row.post_ref,
      },
    ];
  });
  const page = mapped.slice(0, limit);
  const last = page.at(-1);
  const nextCursor = mapped.length > limit && last ? encodeNotificationCursor({ at: last.occurredAt, key: last.key }) : null;
  return { rows: page, nextCursor };
}

export type NotificationSyncState = {
  syncedAt: string | null;
  motivo: string | null;
  status: number | null;
  counts: NotificationCounts | null;
  ok: boolean;
};

export async function notificationSyncState(sql: NotificationSql, creatorId: string): Promise<NotificationSyncState> {
  const rows = await sql.query<{
    last_attempt_at: Date | string | null;
    last_status: string;
    last_reason: string | null;
    last_http_status: number | string | null;
    unread_counts: NotificationCounts | string | null;
  }>(
    "select last_attempt_at, last_status, last_reason, last_http_status, unread_counts from of_notification_sync where creator_id = $1",
    [creatorId],
  );
  const row = rows[0];
  if (!row) return { syncedAt: null, motivo: null, status: null, counts: null, ok: false };
  const ok = row.last_status === "ok";
  return {
    syncedAt: asIso(row.last_attempt_at),
    motivo: row.last_reason,
    status: row.last_http_status == null ? null : Number(row.last_http_status),
    counts: ok ? asCounts(row.unread_counts) : null,
    ok,
  };
}

export async function notificationSyncedAt(sql: NotificationSql, creatorId: string): Promise<string | null> {
  const state = await notificationSyncState(sql, creatorId);
  if (!state.ok) return null;
  return state.syncedAt;
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
    return {
      role: access.role,
      syncedAt: null as string | null,
      items: [] as NotificationListRow[],
      nextCursor: null as string | null,
      counts: null as NotificationCounts | null,
      motivo: null as string | null,
      status: null as number | null,
    };
  }
  const [page, sync] = await Promise.all([
    listNotificationRows(sql, creatorId, access.userId, { cursor, role: access.role }),
    notificationSyncState(sql, creatorId),
  ]);
  return {
    role: access.role,
    syncedAt: sync.ok ? sync.syncedAt : null,
    counts: sync.counts,
    motivo: sync.motivo,
    status: sync.status,
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
          ofUnread: row.ofUnread ?? null,
          fanHandle: row.fanHandle ?? null,
          avatarUrl: row.avatarUrl ?? null,
          lists: row.lists ?? null,
          renewAuto: row.renewAuto ?? null,
          fanSeenAt: row.fanSeenAt ?? null,
          postRef: row.postRef ?? null,
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
  ofUnread: boolean | null;
  fanHandle: string | null;
  avatarUrl: string | null;
  lists: string[] | null;
  renewAuto: boolean | null;
  fanSeenAt: string | null;
  postRef: string | null;
  labels: NonNullable<ReturnType<typeof notificationLabels>>;
};

function boolOrNull(value: boolean | string | null): boolean | null {
  if (value == null) return null;
  if (value === true || value === "t" || value === "true") return true;
  if (value === false || value === "f" || value === "false") return false;
  return null;
}

function listsText(lists: string[] | null | undefined): string | null {
  if (lists == null) return null;
  return lists.join("\n");
}

function listsOf(value: string | null): string[] | null {
  if (value == null) return null;
  if (value === "") return [];
  return value.split("\n").filter((item) => item.length > 0);
}

function asCounts(value: NotificationCounts | string | null): NotificationCounts | null {
  if (!value) return null;
  const parsed = typeof value === "string" ? safeJson(value) : value;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const raw = parsed as Partial<Record<keyof NotificationCounts, unknown>>;
  const counts: NotificationCounts = {
    all: countOrNull(raw.all),
    subscriptions: countOrNull(raw.subscriptions),
    purchases: countOrNull(raw.purchases),
    tips: countOrNull(raw.tips),
    tags: countOrNull(raw.tags),
    comments: countOrNull(raw.comments),
    mentions: countOrNull(raw.mentions),
    likes: countOrNull(raw.likes),
    promotions: countOrNull(raw.promotions),
    onlyfans: countOrNull(raw.onlyfans),
  };
  return Object.values(counts).some((item) => item != null) ? counts : null;
}

function countOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export async function markableNotifications(
  sql: NotificationSql,
  access: { userId: string; role: "owner" | "member"; creatorIds: string[] },
  creatorId: string,
  keys: string[] | null,
): Promise<Array<{ key: string; kind: NotificationRecord["kind"] }>> {
  if (!canReadCreatorNotifications(access, creatorId)) {
    throw new WorkspaceAccessError("No tienes esa cuenta.");
  }
  const rows = keys == null
    ? await sql.query<{ notification_key: string; kind: string }>(
      "select notification_key, kind from of_notification where creator_id = $1 limit 500",
      [creatorId],
    ).then((found) => found.flatMap((row) => {
      const kind = asKind(row.kind);
      return kind ? [{ key: row.notification_key, kind }] : [];
    }))
    : await notificationKinds(sql, creatorId, keys);
  return rows.filter((row) => access.role === "owner" || !isOwnerOnlyKind(row.kind));
}

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
