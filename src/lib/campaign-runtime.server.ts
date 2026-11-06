import { randomUUID } from "node:crypto";
import { getSql } from "@/lib/db";
import { canOperateCreator, WorkspaceAccessError } from "@/lib/access-policy";
import { ensureStaff } from "@/lib/workspace-store";
import { DEV_USER_ID, authConfigured } from "@/lib/auth/verify.server";
import { fansInSegment, previewBody, sendGate, type SegmentKind } from "../../server/of-sessions/campaigns/segment.ts";
import { onlyFansSite } from "../../server/of-sessions/sessions/onlyfans.ts";

export type CampaignDraftView = {
  id: string;
  creatorId: string;
  name: string;
  segment: SegmentKind;
  body: string;
  priceCents: number | null;
  vaultIds: string[];
  scheduledAt: string | null;
  recipientCount: number;
  purchases: number | null;
  revenueCents: number | null;
  status: "draft" | "scheduled";
};

const SEGMENTS: SegmentKind[] = ["active", "expired", "spent", "quiet", "whale", "risk", "asleep", "new"];

export function sendEnabled(): boolean {
  return sendGate(process.env.FANLINK_ENABLE_SEND, onlyFansSite.hostname).allowed;
}

export async function previewCampaignView(
  userId: string,
  input: { creatorId: string; segment: string; body: string; minSpentCents: number; quietDays: number },
): Promise<{ count: number; samples: string[] }> {
  await assertCreator(userId, input.creatorId);
  const segment = parseSegment(input.segment);
  const fans = fansInSegment(await loadFans(input.creatorId), segment, {
    minSpentCents: Math.max(0, input.minSpentCents),
    quietDays: Math.max(1, input.quietDays),
    now: new Date(),
  });
  return {
    count: fans.length,
    samples: fans.slice(0, 3).map((fan) => previewBody(input.body, fan.name ?? fan.fanKey)),
  };
}

export async function saveCampaignDraftView(
  userId: string,
  input: {
    creatorId: string;
    name: string;
    segment: string;
    body: string;
    priceCents: number | null;
    vaultIds: string[];
    scheduledAt: string | null;
    minSpentCents: number;
    quietDays: number;
  },
): Promise<CampaignDraftView> {
  await assertCreator(userId, input.creatorId);
  const segment = parseSegment(input.segment);
  const fans = fansInSegment(await loadFans(input.creatorId), segment, {
    minSpentCents: Math.max(0, input.minSpentCents),
    quietDays: Math.max(1, input.quietDays),
    now: new Date(),
  });
  const id = randomUUID();
  const status = input.scheduledAt ? "scheduled" : "draft";
  const sql = await getSql();
  await sql.query(
    `insert into of_campaign_draft (
       id, creator_id, name, segment, body, price_cents, vault_ids, scheduled_at, recipient_count, status
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      id,
      input.creatorId,
      input.name.slice(0, 80),
      segment,
      input.body.slice(0, 2000),
      input.priceCents,
      input.vaultIds.slice(0, 12).join(","),
      input.scheduledAt,
      fans.length,
      status,
    ],
  );
  return {
    id,
    creatorId: input.creatorId,
    name: input.name.slice(0, 80),
    segment,
    body: input.body.slice(0, 2000),
    priceCents: input.priceCents,
    vaultIds: input.vaultIds.slice(0, 12),
    scheduledAt: input.scheduledAt,
    recipientCount: fans.length,
    purchases: null,
    revenueCents: null,
    status,
  };
}

export async function listCampaignDraftViews(userId: string): Promise<CampaignDraftView[]> {
  const access = await accessFor(userId);
  const sql = await getSql();
  const rows = await sql.query<{
    id: string;
    creator_id: string;
    name: string;
    segment: string;
    body: string;
    price_cents: number | null;
    vault_ids: string;
    scheduled_at: Date | string | null;
    recipient_count: number;
    status: string;
    purchases: number | null;
    revenue_cents: number | null;
  }>(`select d.id, d.creator_id, d.name, d.segment, d.body, d.price_cents, d.vault_ids, d.scheduled_at,
            d.recipient_count, d.status, r.purchases, r.revenue_cents
     from of_campaign_draft d
     left join of_campaign_result r on r.draft_id = d.id
     order by d.created_at desc`);
  return rows.flatMap((row) => {
    if (access.role !== "owner" && !access.creatorIds.includes(row.creator_id)) return [];
    return [
      {
        id: row.id,
        creatorId: row.creator_id,
        name: row.name,
        segment: parseSegment(row.segment),
        body: row.body,
        priceCents: row.price_cents,
        vaultIds: row.vault_ids ? row.vault_ids.split(",").filter(Boolean) : [],
        scheduledAt: row.scheduled_at == null ? null : new Date(row.scheduled_at).toISOString(),
        recipientCount: Number(row.recipient_count),
        purchases: row.purchases == null ? null : Number(row.purchases),
        revenueCents: row.revenue_cents == null ? null : Number(row.revenue_cents),
        status: row.status === "scheduled" ? "scheduled" : "draft",
      },
    ];
  });
}

export function refuseRealSend(): { ok: false; reason: string } {
  const gate = sendGate(process.env.FANLINK_ENABLE_SEND, onlyFansSite.hostname);
  return { ok: false, reason: gate.allowed ? "No se envía a OnlyFans real." : gate.reason };
}

async function loadFans(creatorId: string) {
  const sql = await getSql();
  const fans = await sql.query<{
    fan_key: string;
    display_name: string | null;
    status: string;
    spent_cents: number | null;
    renew_auto: boolean | null;
    subscribed_at: Date | string | null;
  }>(
    "select fan_key, display_name, status, spent_cents, renew_auto, subscribed_at from of_fan_read where creator_id = $1",
    [creatorId],
  );
  const touches = await sql.query<{ fan_key: string | null; sent_at: Date | string }>(
    "select fan_key, max(sent_at) as sent_at from of_chat_message where creator_id = $1 and from_fan = true group by fan_key",
    [creatorId],
  );
  const last = new Map(touches.map((row) => [row.fan_key, row.sent_at instanceof Date ? row.sent_at.toISOString() : String(row.sent_at)]));
  return fans.map((fan) => ({
    fanKey: fan.fan_key,
    name: fan.display_name,
    status: fan.status === "expired" ? ("expired" as const) : ("active" as const),
    spentCents: fan.spent_cents == null ? null : Number(fan.spent_cents),
    lastInteractionAt: last.get(fan.fan_key) ?? null,
    renewAuto: fan.renew_auto,
    subscribedAt: fan.subscribed_at == null ? null : new Date(fan.subscribed_at).toISOString(),
  }));
}

function parseSegment(value: string): SegmentKind {
  if (SEGMENTS.includes(value as SegmentKind)) return value as SegmentKind;
  throw new WorkspaceAccessError("El segmento no es válido.");
}

async function accessFor(userId: string) {
  const sql = await getSql();
  return ensureStaff(sql, userId, !authConfigured && userId === DEV_USER_ID);
}

async function assertCreator(userId: string, creatorId: string) {
  const access = await accessFor(userId);
  if (!canOperateCreator(access, creatorId, "campanas") && access.role !== "owner") {
    throw new WorkspaceAccessError("No tienes acceso a las campañas de esa creadora.");
  }
}
