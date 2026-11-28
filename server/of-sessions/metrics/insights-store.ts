import type { InsightAttribution, InsightCreator, InsightData, InsightFan, InsightMessage, InsightTx, InsightSnapshot, InsightStaff, SnapshotMetric } from "../../../src/lib/dashboard-insights.ts";
import { emptyWeek, readSlot } from "../../../src/lib/staff-shifts.ts";
import { listCreatorReads } from "../sync/store.ts";

export type InsightSql = { query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]> };

const iso = (value: Date | string | null | undefined): string | null => {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
};
const flag = (value: unknown) => value === true || value === "t" || value === "true";

/** Lee todo lo que necesita el dashboard de las creadoras pedidas. Nunca mezcla creadoras: cada fila lleva su creator_id. */
export async function loadInsightData(sql: InsightSql, creators: InsightCreator[], since: Date): Promise<InsightData> {
  const ids = creators.map((creator) => creator.id);
  if (ids.length === 0) {
    return { creators: [], transactions: [], earnings: [], fans: [], fansSyncedCreatorIds: [], earningsSyncedCreatorIds: [], messages: [], attributions: [], staff: await loadStaff(sql), snapshots: [] };
  }
  const reads = await listCreatorReads(sql, ids);
  const messages = await safe(() => sql.query<{
    creator_id: string; message_key: string; thread_key: string; fan_key: string | null; sent_at: Date | string; from_fan: unknown;
    price_cents: number | string | null; purchased: unknown; author_id: string | null; mass_id: string | null;
  }>(
    `select creator_id, message_key, thread_key, fan_key, sent_at, from_fan, price_cents, purchased, author_id, mass_id
       from of_chat_message where creator_id = any($1::text[]) and sent_at >= $2`,
    [ids, since.toISOString()],
  ), []);
  const attributions = await safe(() => sql.query<{
    sale_key: string; creator_id: string; fan_key: string | null; kind: string; sold_at: Date | string; gross_cents: number | string; chatter_id: string | null; chatter_name: string | null;
  }>(
    `select sale_key, creator_id, fan_key, kind, sold_at, gross_cents, chatter_id, chatter_name
       from of_sale_attribution where creator_id = any($1::text[]) and sold_at >= $2`,
    [ids, since.toISOString()],
  ), []);
  const needSales = reads.filter((read) => !read.earningsSyncedAt && read.transactions.length === 0).map((read) => read.creatorId);
  const needFans = reads.filter((read) => !read.fansSyncedAt).map((read) => read.creatorId);
  // Creadoras sin fila en of_sync_state también cuentan: no tienen lectura de nada.
  for (const id of ids) {
    if (!reads.some((read) => read.creatorId === id)) {
      needSales.push(id);
      needFans.push(id);
    }
  }
  const notifSales = needSales.length === 0 ? [] : await safe(() => sql.query<{
    creator_id: string; notification_key: string; kind: string; fan_key: string | null; amount_cents: number | string | null; occurred_at: Date | string | null;
  }>(
    `select creator_id, notification_key, kind, fan_key, amount_cents, occurred_at
       from of_notification
      where creator_id = any($1::text[]) and amount_cents > 0 and occurred_at is not null and occurred_at >= $2
        and kind in ('subscription', 'renewal', 'tip', 'ppv')`,
    [needSales, since.toISOString()],
  ), []);
  const chatFans = needFans.length === 0 ? [] : await safe(() => sql.query<{
    creator_id: string; fan_key: string; fan_handle: string | null; fan_name: string | null; spent_cents: number | string | null;
    sub_started_at: Date | string | null; sub_expires_at: Date | string | null; renew_auto: unknown;
  }>(
    `select creator_id, fan_key, fan_handle, fan_name, spent_cents, sub_started_at, sub_expires_at, renew_auto
       from of_chat_thread
      where creator_id = any($1::text[]) and fan_key is not null
        and (sub_started_at is not null or sub_expires_at is not null or renew_auto is not null)`,
    [needFans],
  ), []);
  const nowMs = Date.now();
  const fansFromChats = chatFans.map((row): InsightFan => {
    const expires = iso(row.sub_expires_at);
    const renew = row.renew_auto == null ? null : flag(row.renew_auto);
    const active = expires ? Date.parse(expires) > nowMs : renew === true;
    return {
      creatorId: row.creator_id,
      fanKey: row.fan_key,
      name: row.fan_name,
      handle: row.fan_handle,
      status: active ? "active" : "expired",
      subscribedAt: iso(row.sub_started_at),
      expiresAt: expires,
      renewAuto: renew,
      spentCents: row.spent_cents == null ? null : Number(row.spent_cents),
    };
  });
  const salesFromNotifications = notifSales.map((row): InsightTx => ({
    creatorId: row.creator_id,
    key: `notif:${row.notification_key}`,
    at: iso(row.occurred_at) ?? "",
    grossCents: Number(row.amount_cents),
    netCents: null,
    kind: row.kind === "ppv" ? "message" : row.kind,
    fanKey: row.fan_key,
  })).filter((row) => row.at && Number.isFinite(row.grossCents) && row.grossCents > 0);
  const snapshots = await safe(() => sql.query<{ creator_id: string; metric: string; taken_at: Date | string; value: number | string }>(
    `select creator_id, metric, taken_at, value from of_dashboard_snapshot where creator_id = any($1::text[]) and taken_at >= $2`,
    [ids, since.toISOString()],
  ), []);
  const chatFanCreators = [...new Set(fansFromChats.map((fan) => fan.creatorId))];
  const notifCreators = [...new Set(salesFromNotifications.map((tx) => tx.creatorId))];
  return {
    creators,
    transactions: [
      ...reads.flatMap((read) => read.transactions.map((tx) => ({
        creatorId: read.creatorId,
        key: tx.txKey,
        at: tx.occurredAt,
        grossCents: tx.grossCents,
        netCents: tx.netCents,
        kind: tx.kind,
        fanKey: tx.fanKey,
      }))),
      ...salesFromNotifications,
    ],
    fansFromChatsCreatorIds: chatFanCreators,
    salesFromNotificationCreatorIds: notifCreators,
    earnings: reads.flatMap((read) => read.earnings.map((row) => ({ creatorId: read.creatorId, day: row.day, kind: row.kind, amountCents: row.amountCents }))),
    fans: [
      ...reads.flatMap((read) => read.fans.map((fan) => ({
        creatorId: read.creatorId,
        fanKey: fan.fanKey,
        name: fan.displayName,
        handle: fan.handle,
        status: fan.status,
        subscribedAt: fan.subscribedAt,
        expiresAt: fan.expiresAt ?? null,
        renewAuto: fan.renewAuto ?? null,
        spentCents: fan.spentCents,
      }))),
      ...fansFromChats,
    ],
    fansSyncedCreatorIds: [...reads.filter((read) => read.fansSyncedAt).map((read) => read.creatorId), ...chatFanCreators],
    earningsSyncedCreatorIds: reads.filter((read) => read.earningsSyncedAt).map((read) => read.creatorId),
    messages: messages.map((row): InsightMessage => ({
      creatorId: row.creator_id,
      key: row.message_key,
      threadKey: row.thread_key,
      fanKey: row.fan_key,
      at: iso(row.sent_at) ?? "",
      fromFan: flag(row.from_fan),
      priceCents: row.price_cents == null ? null : Number(row.price_cents),
      purchased: row.purchased == null ? null : flag(row.purchased),
      authorId: row.author_id,
      massId: row.mass_id,
    })),
    attributions: attributions.map((row): InsightAttribution => ({
      saleKey: row.sale_key,
      creatorId: row.creator_id,
      fanKey: row.fan_key,
      kind: row.kind,
      at: iso(row.sold_at) ?? "",
      grossCents: Number(row.gross_cents),
      chatterId: row.chatter_id,
      chatterName: row.chatter_name,
    })),
    staff: await loadStaff(sql),
    snapshots: snapshots.map((row): InsightSnapshot => ({ creatorId: row.creator_id, metric: row.metric as SnapshotMetric, takenAt: iso(row.taken_at) ?? "", value: Number(row.value) })),
  };
}

const LEVEL_TEXT: Record<string, string> = {
  owner: "Dueña",
  admin: "Admin",
  supervisor: "Supervisor",
  team_manager: "Team Manager",
  account_manager: "Account Manager",
  analyst: "Analyst",
  chatter: "Chatter",
};

async function loadStaff(sql: InsightSql): Promise<InsightStaff[]> {
  const people = await safe(() => sql.query<{ user_id: string; display_name: string; role: string; level: string | null; roles: unknown; last_seen_at: Date | string | null }>(
    `select user_id, display_name, role, level, roles, last_seen_at from staff_profile where coalesce(status, 'active') = 'active'`,
  ), []);
  const shifts = await safe(() => sql.query<{ user_id: string; weekday: number; is_off: boolean | string; start_minutes: number | string | null; end_minutes: number | string | null }>(
    "select user_id, weekday, is_off, start_minutes, end_minutes from staff_shift",
  ), []);
  return people.map((person) => {
    const week = emptyWeek();
    for (const row of shifts) if (row.user_id === person.user_id) week[Number(row.weekday)] = readSlot(row);
    const roles = Array.isArray(person.roles) ? (person.roles as unknown[]).filter((item): item is string => typeof item === "string") : [];
    const list = roles.length > 0 ? roles : [person.level ?? (person.role === "owner" ? "owner" : "chatter")];
    return {
      id: person.user_id,
      name: person.display_name,
      roleLabel: list.map((role) => LEVEL_TEXT[role] ?? role).join(", "),
      lastSeenAt: iso(person.last_seen_at),
      week,
    };
  });
}

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

/** Guarda una cifra del corte. Repetir el mismo instante la reemplaza. */
export async function saveSnapshot(sql: InsightSql, row: { creatorId: string; metric: SnapshotMetric; takenAt: Date; value: number }): Promise<void> {
  if (!Number.isFinite(row.value) || row.value < 0) return;
  await sql.query(
    `insert into of_dashboard_snapshot (creator_id, metric, taken_at, value) values ($1, $2, $3, $4)
     on conflict (creator_id, metric, taken_at) do update set value = excluded.value`,
    [row.creatorId, row.metric, row.takenAt.toISOString(), Math.round(row.value)],
  );
}

export async function noteCut(sql: InsightSql, cutAt: Date, finished: boolean, accountsRead: number): Promise<void> {
  await sql.query(
    `insert into of_dashboard_cut (cut_at, accounts_read, finished_at) values ($1, $2, $3)
     on conflict (cut_at) do update set accounts_read = excluded.accounts_read, finished_at = coalesce(excluded.finished_at, of_dashboard_cut.finished_at)`,
    [cutAt.toISOString(), accountsRead, finished ? new Date().toISOString() : null],
  );
}

export async function lastFinishedCut(sql: InsightSql): Promise<string | null> {
  const rows = await safe(() => sql.query<{ cut_at: Date | string }>("select cut_at from of_dashboard_cut where finished_at is not null order by cut_at desc limit 1"), []);
  return iso(rows[0]?.cut_at ?? null);
}
