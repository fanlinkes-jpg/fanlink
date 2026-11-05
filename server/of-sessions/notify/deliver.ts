import type { FanMessageEvent } from "../sync/chats.ts";
import type { ReadSql } from "../sync/store.ts";
import { planAlerts, type AlertTarget, type RecentAlert } from "./plan.ts";
import { createWhatsAppSender, normalizePhone, type WhatsAppEnv } from "./whatsapp.ts";

export async function deliverFanAlerts(
  sql: ReadSql,
  events: FanMessageEvent[],
  env: WhatsAppEnv = process.env,
  now = new Date(),
): Promise<number> {
  if (!events.length) return 0;
  const creatorIds = [...new Set(events.map((event) => event.creatorId))];
  const names = await creatorNames(sql, creatorIds);
  const targets = await targetsByCreator(sql, creatorIds, env);
  const recent = await recentAlerts(sql, creatorIds);
  const planned = planAlerts({
    events: events.map((event) => ({
      id: event.id,
      creatorId: event.creatorId,
      creatorName: names.get(event.creatorId) ?? event.creatorId,
      fanKey: event.fanKey,
      fanName: event.fanName,
      excerpt: event.excerpt,
      sentAt: event.sentAt,
    })),
    targetsByCreator: targets,
    recent,
    now,
  });
  const send = createWhatsAppSender(env);
  let sent = 0;
  for (const alert of planned) {
    const result = await send({ to: alert.phone, body: alert.body.slice(0, 900) });
    if (!result.ok) continue;
    sent += 1;
    for (const fanKey of alert.fanKeys) {
      await sql.query(
        `insert into alert_delivery (id, user_id, creator_id, fan_key, sent_at, provider, simulated)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [
          `${alert.userId}:${alert.creatorId}:${fanKey}:${now.getTime()}`.slice(0, 160),
          alert.userId,
          alert.creatorId,
          fanKey,
          now.toISOString(),
          result.provider,
          result.simulated,
        ],
      );
    }
  }
  return sent;
}

async function creatorNames(sql: ReadSql, creatorIds: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const rows = await sql.query<{ state: { creators?: Array<{ id?: string; name?: string; handle?: string }> } | string }>(
    "select state from workspace_state where id = 1",
  );
  const raw = rows[0]?.state;
  const state = typeof raw === "string" ? (JSON.parse(raw) as { creators?: Array<{ id?: string; name?: string; handle?: string }> }) : raw;
  for (const creator of state?.creators ?? []) {
    if (creator.id && creatorIds.includes(creator.id)) {
      names.set(creator.id, creator.name || creator.handle || creator.id);
    }
  }
  return names;
}

async function targetsByCreator(sql: ReadSql, creatorIds: string[], env: WhatsAppEnv): Promise<Map<string, AlertTarget[]>> {
  const filter = creatorIds.map((_, index) => `$${index + 1}`).join(", ");
  const grants = await sql.query<{ user_id: string; creator_id: string }>(
    `select user_id, creator_id from creator_grant where creator_id in (${filter})`,
    creatorIds,
  );
  const userIds = [...new Set(grants.map((row) => row.user_id))];
  const alerts = userIds.length
    ? await sql.query<{ user_id: string; phone: string | null; alerts_enabled: boolean | string; quiet_minutes: number | string | null }>(
        `select user_id, phone, alerts_enabled, quiet_minutes from staff_alert where user_id in (${userIds.map((_, index) => `$${index + 1}`).join(", ")})`,
        userIds,
      )
    : [];
  const byUser = new Map(alerts.map((row) => [row.user_id, row]));
  const map = new Map<string, AlertTarget[]>();
  for (const grant of grants) {
    const alert = byUser.get(grant.user_id);
    const phone = alert?.phone ? normalizePhone(alert.phone) : null;
    const list = map.get(grant.creator_id) ?? [];
    const quiet = Number(alert?.quiet_minutes ?? quietMinutes(env));
    list.push({
      userId: grant.user_id,
      phone,
      enabled: alert?.alerts_enabled === true || alert?.alerts_enabled === "t" || alert?.alerts_enabled === "true",
      quietMinutes: Number.isFinite(quiet) ? quiet : quietMinutes(env),
    });
    map.set(grant.creator_id, list);
  }
  return map;
}

async function recentAlerts(sql: ReadSql, creatorIds: string[]): Promise<RecentAlert[]> {
  const filter = creatorIds.map((_, index) => `$${index + 1}`).join(", ");
  const rows = await sql.query<{ user_id: string; creator_id: string; fan_key: string; sent_at: Date | string }>(
    `select user_id, creator_id, fan_key, sent_at from alert_delivery where creator_id in (${filter})`,
    creatorIds,
  );
  return rows.map((row) => ({
    userId: row.user_id,
    creatorId: row.creator_id,
    fanKey: row.fan_key,
    sentAt: row.sent_at instanceof Date ? row.sent_at.toISOString() : String(row.sent_at),
  }));
}

function quietMinutes(env: WhatsAppEnv): number {
  const value = Number(env.FANLINK_ALERT_QUIET_MIN ?? 15);
  if (!Number.isFinite(value)) return 15;
  return Math.min(1440, Math.max(1, Math.round(value)));
}

