import { canSeeAgencyEarnings } from "../../../src/lib/access-policy.ts";
import {
  chattersOf,
  creatorRowsOf,
  dailyRowsOf,
  dayKey,
  shiftDay,
  defaultRange,
  insightAlertsOf,
  newSubsOf,
  previousRange,
  segmentsOf,
  summaryOf,
  changeOf,
  type Basis,
  type ChatterRow,
  type CreatorRow,
  type DailyRow,
  type Granularity,
  type InsightAlert,
  type InsightData,
  type InsightQuery,
  type NewSubsView,
  type SegmentFan,
  type ShiftNow,
  type SummaryView,
} from "../../../src/lib/dashboard-insights.ts";
import type { FanSegmentId } from "../../../src/lib/fan-segments.ts";
import type { CreatorSyncStatus } from "../../../src/lib/sync-status.ts";

/** Estado por separado de chats, ingresos y fans de cada creadora visible. Sin cifras de dinero. */
export type SourceRow = { creatorId: string; name: string } & CreatorSyncStatus;

export type InsightRequest = {
  from?: string | null;
  to?: string | null;
  creatorId?: string | null;
  tag?: string | null;
  basis?: string | null;
  granularity?: string | null;
};

export type MineView = {
  salesCents: number | null;
  salesChange: number | null;
  ppvSent: number | null;
  ppvBought: number | null;
  conversion: number | null;
  replyMinutes: number | null;
  fansChatted: number | null;
  messagesSent: number | null;
  series: Array<{ label: string; cents: number }>;
};

export type DashboardInsightsView = {
  agency: boolean;
  selfId: string;
  query: InsightQuery & { creatorId: string; tag: string };
  updated: { cutAt: string | null; lastReadAt: string | null; nextCutAt: string | null; cutsEnabled: boolean; hours: number[] };
  creators: Array<{ id: string; name: string; tag: string | null; online: number | null; lastReadAt: string | null }>;
  tags: string[];
  summary: SummaryView | null;
  mine: MineView | null;
  creatorTable: { rows: CreatorRow[]; cards: { creators: number; messageCents: number | null; totalCents: number | null; refundCents: number | null } } | null;
  daily: DailyRow[] | null;
  chatters: {
    rows: ChatterRow[];
    series: Array<{ label: string } & Record<string, number | string>>;
    top: Array<{ userId: string; name: string; cents: number }>;
    totalCents: number | null;
    unattributedCents: number | null;
    shifts: ShiftNow[];
  };
  newSubs: NewSubsView;
  segments: { counts: Record<FanSegmentId | "unknown", number> | null; fans: SegmentFan[] };
  alerts: InsightAlert[];
  sources: SourceRow[];
};

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Limpia lo que pide el navegador. Rango máximo 366 días; por defecto los últimos 30. */
export function normalizeInsightRequest(input: InsightRequest | null | undefined, now: Date): InsightQuery & { creatorId: string; tag: string } {
  const fallback = defaultRange(now, 30);
  let from = typeof input?.from === "string" && DAY_RE.test(input.from) ? input.from : fallback.from;
  let to = typeof input?.to === "string" && DAY_RE.test(input.to) ? input.to : fallback.to;
  const today = dayKey(now);
  if (to > today) to = today;
  if (from > to) from = to;
  if (from < shiftDay(to, -365)) from = shiftDay(to, -365);
  const basis: Basis = input?.basis === "gross" ? "gross" : "net";
  const granularity: Granularity = input?.granularity === "hour" || input?.granularity === "week" || input?.granularity === "month" ? input.granularity : "day";
  const creatorId = typeof input?.creatorId === "string" && input.creatorId.trim() ? input.creatorId.trim() : "all";
  const tag = typeof input?.tag === "string" && input.tag.trim() ? input.tag.trim() : "all";
  return { from, to, basis, granularity, creatorId, tag };
}

/** Desde cuándo hay que leer filas: el periodo anterior entero (para el % de cambio). */
export function insightSince(query: InsightQuery): Date {
  const prev = previousRange(query.from, query.to);
  return new Date(Date.parse(`${prev.from}T00:00:00Z`) - 2 * 86_400_000);
}

/**
 * Arma la vista con los permisos ya aplicados:
 * - Dueña, Admin y Supervisor (permiso «estadisticas»): todo, incluido el dinero de la agencia.
 * - Chatter: solo sus propios números; nunca totales de agencia, ni tabla por creadora, ni comparativa.
 * `data` ya viene recortado a las creadoras que esta persona puede ver.
 */
export function buildInsightsView(input: {
  access: { userId: string; role: "owner" | "member"; perms: string[] };
  data: InsightData;
  query: InsightQuery & { creatorId: string; tag: string };
  cutAt: Date;
  now: Date;
  updated: DashboardInsightsView["updated"];
  lastReads: Map<string, string | null>;
}): DashboardInsightsView {
  const agency = canSeeAgencyEarnings(input.access);
  const allCreators = input.data.creators;
  const tags = [...new Set(allCreators.flatMap((creator) => (creator.tag ? [creator.tag] : [])))].sort();
  const chosen = allCreators.filter((creator) =>
    (input.query.creatorId === "all" || creator.id === input.query.creatorId)
    && (input.query.tag === "all" || creator.tag === input.query.tag));
  const ids = new Set(chosen.map((creator) => creator.id));
  const data: InsightData = {
    ...input.data,
    creators: chosen,
    transactions: input.data.transactions.filter((row) => ids.has(row.creatorId)),
    earnings: input.data.earnings.filter((row) => ids.has(row.creatorId)),
    fans: input.data.fans.filter((row) => ids.has(row.creatorId)),
    fansSyncedCreatorIds: input.data.fansSyncedCreatorIds.filter((id) => ids.has(id)),
    earningsSyncedCreatorIds: input.data.earningsSyncedCreatorIds.filter((id) => ids.has(id)),
    messages: input.data.messages.filter((row) => ids.has(row.creatorId)),
    attributions: input.data.attributions.filter((row) => ids.has(row.creatorId)),
    snapshots: input.data.snapshots.filter((row) => ids.has(row.creatorId)),
  };
  const { query, cutAt, now } = input;
  const chatters = chattersOf(data, query, cutAt, now);
  const online = (creatorId: string) => {
    const rows = input.data.snapshots.filter((row) => row.creatorId === creatorId && row.metric === "online").sort((a, b) => b.takenAt.localeCompare(a.takenAt));
    return rows[0]?.value ?? null;
  };
  const creators = allCreators.map((creator) => ({ id: creator.id, name: creator.name, tag: creator.tag, online: online(creator.id), lastReadAt: input.lastReads.get(creator.id) ?? null }));
  const segments = segmentsOf(data, now);
  const newSubs = newSubsOf(data, query, cutAt, now);

  if (agency) {
    return {
      agency,
      selfId: input.access.userId,
      query,
      updated: input.updated,
      creators,
      tags,
      summary: summaryOf(data, query, cutAt, now),
      mine: null,
      creatorTable: creatorRowsOf(data, query, cutAt),
      daily: dailyRowsOf(data, query, cutAt, now),
      chatters,
      newSubs,
      segments,
      alerts: insightAlertsOf(data, query, cutAt, now, true),
      sources: [],
    };
  }

  // Chatter: solo lo suyo.
  const self = input.access.userId;
  const mineRow = chatters.rows.find((row) => row.userId === self) ?? null;
  const prev = previousRange(query.from, query.to);
  const before = chattersOf(data, { ...query, from: prev.from, to: prev.to }, cutAt, now).rows.find((row) => row.userId === self) ?? null;
  const mine: MineView = {
    salesCents: mineRow?.salesCents ?? null,
    salesChange: changeOf(mineRow?.salesCents ?? null, before?.salesCents ?? null),
    ppvSent: mineRow?.ppvSent ?? null,
    ppvBought: mineRow?.ppvBought ?? null,
    conversion: mineRow?.conversion ?? null,
    replyMinutes: mineRow?.replyMinutes ?? null,
    fansChatted: mineRow?.fansChatted ?? null,
    messagesSent: mineRow?.messagesSent ?? null,
    series: chatters.series.map((row) => ({ label: row.label, cents: Number(row[self] ?? 0) })),
  };
  const ownAlerts = insightAlertsOf(data, query, cutAt, now, false).filter((alert) => alert.kind !== "shift" || alert.text.startsWith(`${nameOf(data, self)}:`));
  return {
    agency,
    selfId: self,
    query,
    updated: input.updated,
    creators,
    tags,
    summary: null,
    mine,
    creatorTable: null,
    daily: null,
    chatters: {
      rows: mineRow ? [mineRow] : [],
      series: chatters.series.map((row) => ({ label: row.label, [self]: Number(row[self] ?? 0) })),
      top: chatters.top.filter((row) => row.userId === self),
      totalCents: null,
      unattributedCents: null,
      shifts: chatters.shifts.filter((row) => row.userId === self),
    },
    newSubs,
    segments,
    alerts: ownAlerts,
    sources: [],
  };
}

function nameOf(data: InsightData, userId: string): string {
  return data.staff.find((person) => person.id === userId)?.name ?? userId;
}
