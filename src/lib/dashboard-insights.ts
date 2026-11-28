/**
 * Cálculo del Dashboard (CDF-20). Todo sale de lo guardado de OnlyFans y del CRM; si falta un dato,
 * la cifra es null y la pantalla pinta «Sin datos». Nada se inventa.
 *
 * - Las cifras van hasta el último corte (`cutAt`): el dashboard no es en tiempo real.
 * - Neto: el neto que da OnlyFans; si una venta no lo trae, el 80 % del bruto (la comisión fija de OnlyFans).
 * - Días, horas y semanas en Europe/Madrid.
 */
import { addMadridDays, madridInstant, madridParts, durationMinutes, windowStartingOn, cellStatus, type ShiftSlot, type ShiftStatus } from "./staff-shifts.ts";
import { countSegments, fanSegments, spendSegmentOf, isNewFan, type FanSegmentId } from "./fan-segments.ts";

export type Basis = "net" | "gross";
export type Granularity = "hour" | "day" | "week" | "month";
export type Channel = "subs" | "messages" | "tips" | "posts" | "referrals" | "streams";
export const CHANNELS: readonly Channel[] = ["subs", "messages", "tips", "posts", "referrals", "streams"];
export const CHANNEL_LABELS: Record<Channel, string> = {
  subs: "Suscripciones",
  messages: "Mensajes",
  tips: "Propinas",
  posts: "Posts",
  referrals: "Referidos",
  streams: "Directos",
};

export const OF_NET_SHARE = 0.8;

export type InsightTx = {
  creatorId: string;
  key: string;
  at: string;
  grossCents: number;
  netCents: number | null;
  kind: string;
  fanKey: string | null;
};
export type InsightEarning = { creatorId: string; day: string; kind: string; amountCents: number };
export type InsightFan = {
  creatorId: string;
  fanKey: string;
  name: string | null;
  handle: string | null;
  status: "active" | "expired";
  subscribedAt: string | null;
  expiresAt: string | null;
  renewAuto: boolean | null;
  spentCents: number | null;
};
export type InsightMessage = {
  creatorId: string;
  key: string;
  threadKey: string;
  fanKey: string | null;
  at: string;
  fromFan: boolean;
  priceCents: number | null;
  purchased: boolean | null;
  authorId: string | null;
  massId: string | null;
};
export type InsightAttribution = {
  saleKey: string;
  creatorId: string;
  fanKey: string | null;
  kind: string;
  at: string;
  grossCents: number;
  chatterId: string | null;
  chatterName: string | null;
};
export type InsightCreator = { id: string; name: string; tag: string | null; avatarUrl?: string | null };
export type InsightStaff = { id: string; name: string; roleLabel: string; lastSeenAt: string | null; week: ShiftSlot[] };
/** Cifras sueltas leídas en un corte: fans online, visitas al perfil, clics de enlaces, ranking… */
export type InsightSnapshot = { creatorId: string; metric: SnapshotMetric; takenAt: string; value: number };
export type SnapshotMetric = "online" | "profile_visitors" | "link_clicks" | "of_ranking" | "following";

export type InsightData = {
  creators: InsightCreator[];
  transactions: InsightTx[];
  earnings: InsightEarning[];
  fans: InsightFan[];
  fansSyncedCreatorIds: string[];
  earningsSyncedCreatorIds: string[];
  messages: InsightMessage[];
  attributions: InsightAttribution[];
  staff: InsightStaff[];
  snapshots: InsightSnapshot[];
};

export type InsightQuery = {
  /** Primer día (YYYY-MM-DD, Madrid), incluido. */
  from: string;
  /** Último día (YYYY-MM-DD, Madrid), incluido. */
  to: string;
  basis: Basis;
  granularity: Granularity;
};

export type Kpi = { value: number | null; previous: number | null; change: number | null; spark: Array<number | null> };

type Sale = {
  creatorId: string;
  at: number;
  day: string;
  hour: number | null;
  weekday: number;
  channel: Channel;
  kind: string;
  fanKey: string | null;
  gross: number;
  net: number;
};

const DAY_MS = 86_400_000;

// ---------- fechas ----------

export function dayKey(at: Date | number | string): string {
  const parts = madridParts(new Date(at));
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function parseDay(day: string): { year: number; month: number; day: number } {
  const [year, month, date] = day.split("-").map(Number);
  return { year: year ?? 2026, month: month ?? 1, day: date ?? 1 };
}

export function dayStart(day: string): Date {
  const parts = parseDay(day);
  return madridInstant(parts.year, parts.month, parts.day, 0);
}

export function shiftDay(day: string, delta: number): string {
  const next = addMadridDays(parseDay(day), delta);
  return `${next.year}-${String(next.month).padStart(2, "0")}-${String(next.day).padStart(2, "0")}`;
}

export function daysBetween(from: string, to: string): string[] {
  const days: string[] = [];
  let cursor = from;
  while (cursor <= to && days.length < 400) {
    days.push(cursor);
    cursor = shiftDay(cursor, 1);
  }
  return days;
}

/** Periodo anterior de la misma longitud, justo antes. */
export function previousRange(from: string, to: string): { from: string; to: string } {
  const length = daysBetween(from, to).length;
  return { from: shiftDay(from, -length), to: shiftDay(from, -1) };
}

/** Rango por defecto: los últimos 30 días hasta hoy (hoy queda abierto hasta el corte). */
export function defaultRange(now: Date, days = 30): { from: string; to: string } {
  const to = dayKey(now);
  return { from: shiftDay(to, -(days - 1)), to };
}

function rangeBounds(from: string, to: string, cutAt: Date): { start: number; end: number } {
  const start = dayStart(from).getTime();
  const end = Math.min(dayStart(shiftDay(to, 1)).getTime(), cutAt.getTime());
  return { start, end };
}

// ---------- ventas ----------

export function channelOf(kind: string): Channel | null {
  switch (kind) {
    case "subscription":
    case "renewal":
      return "subs";
    case "message":
    case "ppv":
    case "mass":
      return "messages";
    case "tip":
      return "tips";
    case "post":
      return "posts";
    case "referral":
      return "referrals";
    case "stream":
      return "streams";
    default:
      return null;
  }
}

export function amountOf(row: { grossCents: number; netCents: number | null }, basis: Basis): number {
  if (basis === "gross") return row.grossCents;
  return row.netCents ?? Math.round(row.grossCents * OF_NET_SHARE);
}

/**
 * Ventas hasta el corte. Con transacciones de un día manda ese detalle; un día de una creadora sin
 * transacciones usa la fila diaria de la gráfica de ingresos (sin hora: no entra en hora ni mapa de calor).
 */
export function salesOf(data: Pick<InsightData, "transactions" | "earnings">, cutAt: Date): Sale[] {
  const sales: Sale[] = [];
  const txDays = new Set<string>();
  for (const tx of data.transactions) {
    const at = Date.parse(tx.at);
    if (!Number.isFinite(at) || at >= cutAt.getTime()) continue;
    const channel = channelOf(tx.kind);
    if (!channel) continue;
    const parts = madridParts(new Date(at));
    const day = dayKey(at);
    txDays.add(`${tx.creatorId}|${day}`);
    sales.push({
      creatorId: tx.creatorId,
      at,
      day,
      hour: parts.hour,
      weekday: parts.weekday,
      channel,
      kind: tx.kind,
      fanKey: tx.fanKey,
      gross: tx.grossCents,
      net: amountOf(tx, "net"),
    });
  }
  for (const row of data.earnings) {
    if (row.kind === "total") continue;
    if (txDays.has(`${row.creatorId}|${row.day}`)) continue;
    const channel = channelOf(row.kind);
    if (!channel) continue;
    const at = dayStart(row.day).getTime() + 12 * 3_600_000;
    if (at >= cutAt.getTime()) continue;
    sales.push({
      creatorId: row.creatorId,
      at,
      day: row.day,
      hour: null,
      weekday: madridParts(new Date(at)).weekday,
      channel,
      kind: row.kind,
      fanKey: null,
      gross: row.amountCents,
      net: Math.round(row.amountCents * OF_NET_SHARE),
    });
  }
  return sales.sort((a, b) => a.at - b.at);
}

function pick(sale: Sale, basis: Basis): number {
  return basis === "net" ? sale.net : sale.gross;
}

function sumOf<T>(rows: readonly T[], fn: (row: T) => number): number {
  let total = 0;
  for (const row of rows) total += fn(row);
  return total;
}

export function changeOf(current: number | null, previous: number | null): number | null {
  if (current == null || previous == null || previous === 0) return null;
  return (current - previous) / previous;
}

function kpi(value: number | null, previous: number | null, spark: Array<number | null>): Kpi {
  return { value, previous, change: changeOf(value, previous), spark };
}

// ---------- resumen ----------

export type SummaryView = {
  hasSales: boolean;
  kpis: {
    total: Kpi;
    subs: Kpi;
    messages: Kpi;
    tips: Kpi;
    posts: Kpi;
    referrals: Kpi;
    streams: Kpi;
    activeFans: Kpi;
    newSubs: Kpi;
    purchases: Kpi;
    fansOnline: Kpi;
    messagesSent: Kpi;
  };
  series: Array<{ label: string; cents: number; partial: boolean }>;
  byChannel: Array<{ label: string } & Record<Channel, number>>;
  breakdown: Array<{ channel: Channel; cents: number; share: number }>;
  bestDay: { totals: number[]; best: number | null } | null;
  bestHour: { totals: number[]; best: number | null } | null;
  clv: { cents: number; avgSubscribers: number } | null;
  topFans: Array<{ creatorId: string; creatorName: string; fanKey: string; name: string; purchases: number; cents: number; lifetimeCents: number | null }>;
  heatmap: { revenue: number[][] | null; activity: number[][] | null };
};

export function summaryOf(data: InsightData, query: InsightQuery, cutAt: Date, now: Date): SummaryView {
  const all = salesOf(data, cutAt);
  const { start, end } = rangeBounds(query.from, query.to, cutAt);
  const prev = previousRange(query.from, query.to);
  const prevBounds = rangeBounds(prev.from, prev.to, cutAt);
  const inRange = all.filter((sale) => sale.at >= start && sale.at < end);
  const inPrev = all.filter((sale) => sale.at >= prevBounds.start && sale.at < prevBounds.end);
  const days = daysBetween(query.from, query.to);
  const syncedEarnings = data.earningsSyncedCreatorIds.length > 0 || data.transactions.length > 0;
  const money = (rows: Sale[], channel?: Channel) => {
    if (!syncedEarnings) return null;
    const list = channel ? rows.filter((sale) => sale.channel === channel) : rows;
    return sumOf(list, (sale) => pick(sale, query.basis));
  };
  const daily = (channel?: Channel) => {
    if (!syncedEarnings) return days.map(() => null);
    const map = new Map<string, number>();
    for (const sale of inRange) {
      if (channel && sale.channel !== channel) continue;
      map.set(sale.day, (map.get(sale.day) ?? 0) + pick(sale, query.basis));
    }
    return days.map((day) => map.get(day) ?? 0);
  };
  const channelKpi = (channel?: Channel) => kpi(money(inRange, channel), money(inPrev, channel), daily(channel));

  const fansSynced = data.fansSyncedCreatorIds.length > 0;
  const activeAt = (instant: number) =>
    data.fans.filter((fan) => {
      const sub = fan.subscribedAt ? Date.parse(fan.subscribedAt) : null;
      if (sub != null && sub > instant) return false;
      if (fan.status === "active") return true;
      const exp = fan.expiresAt ? Date.parse(fan.expiresAt) : null;
      return exp != null && exp > instant;
    }).length;
  const activeNow = fansSynced ? data.fans.filter((fan) => fan.status === "active").length : null;
  const activeSpark = fansSynced ? days.map((day) => activeAt(Math.min(dayStart(shiftDay(day, 1)).getTime() - 1, end))) : days.map(() => null);
  const activePrev = fansSynced ? activeAt(prevBounds.end - 1) : null;

  const newIn = (from: number, to: number) => data.fans.filter((fan) => {
    const at = fan.subscribedAt ? Date.parse(fan.subscribedAt) : NaN;
    return Number.isFinite(at) && at >= from && at < to;
  });
  const newSpark = fansSynced
    ? days.map((day) => newIn(dayStart(day).getTime(), Math.min(dayStart(shiftDay(day, 1)).getTime(), end)).length)
    : days.map(() => null);

  const purchaseKinds = new Set(["message", "post", "ppv", "mass"]);
  const purchases = (rows: Sale[]) => (data.transactions.length > 0 ? rows.filter((sale) => purchaseKinds.has(sale.kind) && sale.hour != null).length : null);
  const purchaseSpark = data.transactions.length > 0
    ? days.map((day) => inRange.filter((sale) => sale.day === day && purchaseKinds.has(sale.kind) && sale.hour != null).length)
    : days.map(() => null);

  const online = latestSnapshotTotal(data.snapshots, "online", data.creators.map((creator) => creator.id), cutAt);

  const sent = (from: number, to: number) => data.messages.filter((message) => {
    const at = Date.parse(message.at);
    return !message.fromFan && at >= from && at < to;
  }).length;
  const hasMessages = data.messages.length > 0;

  // Series por granularidad.
  const series = seriesOf(inRange, query, cutAt, now, syncedEarnings);
  const byChannel = days.map((day) => {
    const row = { label: day } as { label: string } & Record<Channel, number>;
    for (const channel of CHANNELS) row[channel] = 0;
    for (const sale of inRange) if (sale.day === day) row[sale.channel] += pick(sale, query.basis);
    return row;
  });
  const total = sumOf(inRange, (sale) => pick(sale, query.basis));
  const breakdown = CHANNELS.map((channel) => {
    const cents = sumOf(inRange.filter((sale) => sale.channel === channel), (sale) => pick(sale, query.basis));
    return { channel, cents, share: total > 0 ? cents / total : 0 };
  }).filter((row) => row.cents > 0);

  const timed = inRange.filter((sale) => sale.hour != null);
  const bestDay = inRange.length > 0
    ? (() => {
        const totals = Array.from({ length: 7 }, () => 0);
        for (const sale of inRange) totals[sale.weekday] = (totals[sale.weekday] ?? 0) + pick(sale, query.basis);
        return { totals, best: argMax(totals) };
      })()
    : null;
  const bestHour = timed.length > 0
    ? (() => {
        const totals = Array.from({ length: 24 }, () => 0);
        for (const sale of timed) totals[sale.hour ?? 0] = (totals[sale.hour ?? 0] ?? 0) + pick(sale, query.basis);
        return { totals, best: argMax(totals) };
      })()
    : null;

  const avgSubscribers = fansSynced && activeSpark.length > 0
    ? sumOf(activeSpark, (value) => value ?? 0) / activeSpark.length
    : null;
  const clv = syncedEarnings && avgSubscribers != null && avgSubscribers > 0
    ? { cents: Math.round(total / avgSubscribers), avgSubscribers: Math.round(avgSubscribers * 10) / 10 }
    : null;

  const fanName = new Map(data.fans.map((fan) => [`${fan.creatorId}|${fan.fanKey}`, fan]));
  const perFan = new Map<string, { creatorId: string; fanKey: string; purchases: number; cents: number }>();
  for (const sale of inRange) {
    if (!sale.fanKey) continue;
    const key = `${sale.creatorId}|${sale.fanKey}`;
    const row = perFan.get(key) ?? { creatorId: sale.creatorId, fanKey: sale.fanKey, purchases: 0, cents: 0 };
    row.purchases += 1;
    row.cents += pick(sale, query.basis);
    perFan.set(key, row);
  }
  const topFans = [...perFan.values()]
    .sort((a, b) => b.cents - a.cents || b.purchases - a.purchases)
    .slice(0, 10)
    .map((row) => {
      const fan = fanName.get(`${row.creatorId}|${row.fanKey}`);
      return { ...row, creatorName: data.creators.find((creator) => creator.id === row.creatorId)?.name ?? row.creatorId, name: fan?.name ?? fan?.handle ?? row.fanKey, lifetimeCents: fan?.spentCents ?? null };
    });

  const revenue = timed.length > 0 ? grid() : null;
  if (revenue) for (const sale of timed) revenue[sale.weekday]![sale.hour ?? 0]! += pick(sale, query.basis);
  const fanMessages = data.messages.filter((message) => {
    const at = Date.parse(message.at);
    return message.fromFan && at >= start && at < end;
  });
  const activity = fanMessages.length > 0 ? grid() : null;
  if (activity) {
    for (const message of fanMessages) {
      const parts = madridParts(new Date(message.at));
      activity[parts.weekday]![parts.hour]! += 1;
    }
  }

  return {
    hasSales: inRange.length > 0,
    kpis: {
      total: channelKpi(),
      subs: channelKpi("subs"),
      messages: channelKpi("messages"),
      tips: channelKpi("tips"),
      posts: channelKpi("posts"),
      referrals: channelKpi("referrals"),
      streams: channelKpi("streams"),
      activeFans: kpi(activeNow, activePrev, activeSpark),
      newSubs: kpi(fansSynced ? newIn(start, end).length : null, fansSynced ? newIn(prevBounds.start, prevBounds.end).length : null, newSpark),
      purchases: kpi(purchases(inRange), purchases(inPrev), purchaseSpark),
      fansOnline: kpi(online, null, []),
      messagesSent: kpi(hasMessages ? sent(start, end) : null, hasMessages ? sent(prevBounds.start, prevBounds.end) : null,
        hasMessages ? days.map((day) => sent(dayStart(day).getTime(), Math.min(dayStart(shiftDay(day, 1)).getTime(), end))) : days.map(() => null)),
    },
    series,
    byChannel,
    breakdown,
    bestDay,
    bestHour,
    clv,
    topFans,
    heatmap: { revenue, activity },
  };
}

function grid(): number[][] {
  return Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
}

function argMax(values: number[]): number | null {
  let best: number | null = null;
  values.forEach((value, index) => {
    if (value > 0 && (best == null || value > (values[best] ?? 0))) best = index;
  });
  return best;
}

function seriesOf(sales: Sale[], query: InsightQuery, cutAt: Date, now: Date, synced: boolean): SummaryView["series"] {
  if (!synced) return [];
  const today = dayKey(now);
  const buckets = new Map<string, number>();
  const labels: string[] = [];
  const add = (label: string) => {
    if (!buckets.has(label)) {
      buckets.set(label, 0);
      labels.push(label);
    }
  };
  const days = daysBetween(query.from, query.to);
  if (query.granularity === "hour") {
    for (const day of days) for (let hour = 0; hour < 24; hour += 1) {
      const at = dayStart(day).getTime() + hour * 3_600_000;
      if (at >= cutAt.getTime()) break;
      add(`${day} ${String(hour).padStart(2, "0")}h`);
    }
    for (const sale of sales) if (sale.hour != null) {
      const label = `${sale.day} ${String(sale.hour).padStart(2, "0")}h`;
      buckets.set(label, (buckets.get(label) ?? 0) + pick(sale, query.basis));
    }
  } else {
    const labelOf = (day: string) => (query.granularity === "day" ? day : query.granularity === "week" ? weekLabel(day) : day.slice(0, 7));
    for (const day of days) add(labelOf(day));
    for (const sale of sales) {
      const label = labelOf(sale.day);
      buckets.set(label, (buckets.get(label) ?? 0) + pick(sale, query.basis));
    }
  }
  const partialLabel = query.granularity === "hour" ? null : query.granularity === "day" ? today : query.granularity === "week" ? weekLabel(today) : today.slice(0, 7);
  return labels.map((label) => ({ label, cents: buckets.get(label) ?? 0, partial: label === partialLabel }));
}

/** Semana que empieza en lunes: «sem. 2026-11-23». */
export function weekLabel(day: string): string {
  const weekday = madridParts(new Date(dayStart(day).getTime() + 12 * 3_600_000)).weekday;
  return `sem. ${shiftDay(day, -weekday)}`;
}

function latestSnapshotTotal(snapshots: InsightSnapshot[], metric: SnapshotMetric, creatorIds: string[], cutAt: Date): number | null {
  const latest = new Map<string, InsightSnapshot>();
  for (const row of snapshots) {
    if (row.metric !== metric || !creatorIds.includes(row.creatorId)) continue;
    if (Date.parse(row.takenAt) > cutAt.getTime() + 15 * 60_000) continue;
    const prior = latest.get(row.creatorId);
    if (!prior || prior.takenAt < row.takenAt) latest.set(row.creatorId, row);
  }
  if (latest.size === 0) return null;
  return sumOf([...latest.values()], (row) => row.value);
}

function snapshotSum(snapshots: InsightSnapshot[], metric: SnapshotMetric, creatorId: string, start: number, end: number): number | null {
  const rows = snapshots.filter((row) => row.metric === metric && row.creatorId === creatorId && Date.parse(row.takenAt) >= start && Date.parse(row.takenAt) < end);
  if (rows.length === 0) return null;
  return sumOf(rows, (row) => row.value);
}

// ---------- tabla por creadora ----------

export const CREATOR_COLUMNS = [
  { id: "subsTotal", label: "Suscripciones (total)", kind: "money" },
  { id: "subsNew", label: "Suscripciones nuevas", kind: "money" },
  { id: "subsRecurring", label: "Suscripciones recurrentes", kind: "money" },
  { id: "tips", label: "Propinas", kind: "money" },
  { id: "messages", label: "Mensajes", kind: "money" },
  { id: "engagementRatio", label: "Ratio engagement", kind: "ratio" },
  { id: "posts", label: "Posts", kind: "money" },
  { id: "total", label: "Total", kind: "money" },
  { id: "avgHourly", label: "Media por hora", kind: "money" },
  { id: "refunds", label: "Reembolsos", kind: "money" },
  { id: "contribution", label: "% contribución", kind: "ratio" },
  { id: "ofRanking", label: "Ranking OF", kind: "number" },
  { id: "following", label: "Siguiendo", kind: "number" },
  { id: "renewOn", label: "Fans con renovación", kind: "number" },
  { id: "profileVisitors", label: "Visitas al perfil", kind: "number" },
  { id: "newSubscribers", label: "Nuevos suscriptores", kind: "number" },
  { id: "renewals", label: "Renovaciones", kind: "number" },
  { id: "newSubLtv", label: "LTV nuevo suscriptor", kind: "money" },
  { id: "newSubConversion", label: "Conversión nuevo suscriptor", kind: "ratio" },
  { id: "activeFans", label: "Fans activos", kind: "number" },
  { id: "expiredFans", label: "Caducados en el rango", kind: "number" },
  { id: "totalFans", label: "Total fans", kind: "number" },
  { id: "avgSubDays", label: "Duración media (días)", kind: "number" },
  { id: "spenders", label: "Nº compradores", kind: "number" },
  { id: "avgPerSpender", label: "Gasto medio por comprador", kind: "money" },
  { id: "avgPerTx", label: "Gasto medio por transacción", kind: "money" },
  { id: "avgPerFan", label: "Gasto medio por fan", kind: "money" },
  { id: "replyMinutes", label: "Tiempo de respuesta (min)", kind: "number" },
  { id: "fansChatted", label: "Fans chateados", kind: "number" },
  { id: "messagesSent", label: "Mensajes enviados", kind: "number" },
  { id: "ppvSent", label: "PPV enviados", kind: "number" },
] as const;

export type CreatorColumnId = (typeof CREATOR_COLUMNS)[number]["id"];
export const DEFAULT_CREATOR_COLUMNS: CreatorColumnId[] = ["total", "subsTotal", "messages", "tips", "contribution", "activeFans", "newSubscribers", "spenders", "replyMinutes"];

export type CreatorRow = { creatorId: string; name: string; tag: string | null; values: Record<CreatorColumnId, number | null>; changes: Partial<Record<CreatorColumnId, number | null>> };

export function creatorRowsOf(data: InsightData, query: InsightQuery, cutAt: Date): { rows: CreatorRow[]; cards: { creators: number; messageCents: number | null; totalCents: number | null; refundCents: number | null } } {
  const all = salesOf(data, cutAt);
  const current = rangeBounds(query.from, query.to, cutAt);
  const prev = previousRange(query.from, query.to);
  const prevBounds = rangeBounds(prev.from, prev.to, cutAt);
  const totalAll = sumOf(all.filter((sale) => sale.at >= current.start && sale.at < current.end), (sale) => pick(sale, query.basis));
  const prevTotalAll = sumOf(all.filter((sale) => sale.at >= prevBounds.start && sale.at < prevBounds.end), (sale) => pick(sale, query.basis));
  const build = (creator: InsightCreator, bounds: { start: number; end: number }, agencyTotal: number) => {
    const synced = data.earningsSyncedCreatorIds.includes(creator.id) || data.transactions.some((tx) => tx.creatorId === creator.id);
    const fansSynced = data.fansSyncedCreatorIds.includes(creator.id);
    const sales = all.filter((sale) => sale.creatorId === creator.id && sale.at >= bounds.start && sale.at < bounds.end);
    const hasTx = data.transactions.some((tx) => tx.creatorId === creator.id);
    const money = (filter: (sale: Sale) => boolean) => (synced ? sumOf(sales.filter(filter), (sale) => pick(sale, query.basis)) : null);
    const total = money(() => true);
    const fans = data.fans.filter((fan) => fan.creatorId === creator.id);
    const newFans = fans.filter((fan) => {
      const at = fan.subscribedAt ? Date.parse(fan.subscribedAt) : NaN;
      return Number.isFinite(at) && at >= bounds.start && at < bounds.end;
    });
    const newKeys = new Set(newFans.map((fan) => fan.fanKey));
    const newSpend = sumOf(sales.filter((sale) => sale.fanKey && newKeys.has(sale.fanKey)), (sale) => pick(sale, query.basis));
    const newBuyers = new Set(sales.filter((sale) => sale.fanKey && newKeys.has(sale.fanKey) && sale.channel !== "subs").map((sale) => sale.fanKey)).size;
    const spenderKeys = new Set(sales.filter((sale) => sale.fanKey).map((sale) => sale.fanKey));
    const timedSales = sales.filter((sale) => sale.fanKey);
    const msgs = data.messages.filter((message) => message.creatorId === creator.id && Date.parse(message.at) >= bounds.start && Date.parse(message.at) < bounds.end);
    const hasMsgs = data.messages.some((message) => message.creatorId === creator.id);
    const sent = msgs.filter((message) => !message.fromFan);
    const replies = replyMinutes(msgs);
    const active = fansSynced ? fans.filter((fan) => fan.status === "active").length : null;
    const lengths = fans.flatMap((fan) => {
      const sub = fan.subscribedAt ? Date.parse(fan.subscribedAt) : NaN;
      if (!Number.isFinite(sub)) return [];
      const until = fan.status === "active" ? bounds.end : fan.expiresAt ? Date.parse(fan.expiresAt) : NaN;
      if (!Number.isFinite(until) || until < sub) return [];
      return [(until - sub) / DAY_MS];
    });
    const hours = Math.max(1, (bounds.end - bounds.start) / 3_600_000);
    const subsTotal = money((sale) => sale.channel === "subs");
    const messagesCents = money((sale) => sale.channel === "messages");
    const tipsCents = money((sale) => sale.channel === "tips");
    const values: Record<CreatorColumnId, number | null> = {
      subsTotal,
      subsNew: hasTx ? money((sale) => sale.kind === "subscription") : null,
      subsRecurring: hasTx ? money((sale) => sale.kind === "renewal") : null,
      tips: tipsCents,
      messages: messagesCents,
      engagementRatio: total != null && total > 0 ? ((messagesCents ?? 0) + (tipsCents ?? 0)) / total : null,
      posts: money((sale) => sale.channel === "posts"),
      total,
      avgHourly: total != null ? Math.round(total / hours) : null,
      refunds: null,
      contribution: total != null && agencyTotal > 0 ? total / agencyTotal : null,
      ofRanking: latestSnapshotTotal(data.snapshots, "of_ranking", [creator.id], new Date(bounds.end)),
      following: latestSnapshotTotal(data.snapshots, "following", [creator.id], new Date(bounds.end)),
      renewOn: fansSynced && fans.some((fan) => fan.renewAuto != null) ? fans.filter((fan) => fan.status === "active" && fan.renewAuto === true).length : null,
      profileVisitors: snapshotSum(data.snapshots, "profile_visitors", creator.id, bounds.start, bounds.end),
      newSubscribers: fansSynced ? newFans.length : null,
      renewals: hasTx ? sales.filter((sale) => sale.kind === "renewal").length : null,
      newSubLtv: fansSynced && hasTx && newFans.length > 0 ? Math.round(newSpend / newFans.length) : null,
      newSubConversion: fansSynced && hasTx && newFans.length > 0 ? newBuyers / newFans.length : null,
      activeFans: active,
      expiredFans: fansSynced && fans.some((fan) => fan.expiresAt) ? fans.filter((fan) => fan.status === "expired" && fan.expiresAt && Date.parse(fan.expiresAt) >= bounds.start && Date.parse(fan.expiresAt) < bounds.end).length : null,
      totalFans: fansSynced ? fans.length : null,
      avgSubDays: lengths.length > 0 ? Math.round(sumOf(lengths, (value) => value) / lengths.length) : null,
      spenders: hasTx ? spenderKeys.size : null,
      avgPerSpender: hasTx && spenderKeys.size > 0 ? Math.round(sumOf(timedSales, (sale) => pick(sale, query.basis)) / spenderKeys.size) : null,
      avgPerTx: hasTx && sales.length > 0 ? Math.round((total ?? 0) / sales.length) : null,
      avgPerFan: total != null && active != null && active > 0 ? Math.round(total / active) : null,
      replyMinutes: replies.length > 0 ? Math.round(sumOf(replies, (value) => value) / replies.length) : null,
      fansChatted: hasMsgs ? new Set(sent.map((message) => message.fanKey ?? message.threadKey)).size : null,
      messagesSent: hasMsgs ? sent.length : null,
      ppvSent: hasMsgs ? sent.filter((message) => (message.priceCents ?? 0) > 0).length : null,
    };
    return values;
  };
  const rows = data.creators.map((creator) => {
    const values = build(creator, current, totalAll);
    const before = build(creator, prevBounds, prevTotalAll);
    const changes: Partial<Record<CreatorColumnId, number | null>> = {};
    for (const column of CREATOR_COLUMNS) {
      if (column.id === "ofRanking" || column.id === "following" || column.id === "totalFans") continue;
      changes[column.id] = changeOf(values[column.id], before[column.id]);
    }
    return { creatorId: creator.id, name: creator.name, tag: creator.tag, values, changes };
  });
  const synced = data.earningsSyncedCreatorIds.length > 0 || data.transactions.length > 0;
  return {
    rows,
    cards: {
      creators: data.creators.length,
      messageCents: synced ? sumOf(rows, (row) => row.values.messages ?? 0) : null,
      totalCents: synced ? totalAll : null,
      refundCents: null,
    },
  };
}

/** Minutos desde el primer mensaje del fan hasta la respuesta, por bloque de mensajes del fan. */
export function replyMinutes(messages: readonly InsightMessage[], authorId?: string): number[] {
  const byThread = new Map<string, InsightMessage[]>();
  for (const message of messages) {
    const key = `${message.creatorId}:${message.threadKey}`;
    const list = byThread.get(key) ?? [];
    list.push(message);
    byThread.set(key, list);
  }
  const minutes: number[] = [];
  for (const list of byThread.values()) {
    const ordered = [...list].sort((a, b) => a.at.localeCompare(b.at));
    let index = 0;
    while (index < ordered.length) {
      if (!ordered[index]?.fromFan) {
        index += 1;
        continue;
      }
      const start = ordered[index]!;
      while (index < ordered.length && ordered[index]?.fromFan) index += 1;
      const reply = ordered[index];
      if (!reply) continue;
      if (authorId && reply.authorId !== authorId) continue;
      const delta = (Date.parse(reply.at) - Date.parse(start.at)) / 60_000;
      if (delta >= 0) minutes.push(delta);
    }
  }
  return minutes;
}

// ---------- comparativa diaria ----------

export type DailyRow = {
  day: string;
  partial: boolean;
  totalCents: number | null;
  newSubs: number | null;
  newSubsCents: number | null;
  recurringCents: number | null;
  tipsCents: number | null;
  messagesCents: number | null;
  chatVsSubs: number | null;
  clicks: number | null;
  conversion: number | null;
};

export function dailyRowsOf(data: InsightData, query: InsightQuery, cutAt: Date, now: Date): DailyRow[] {
  const all = salesOf(data, cutAt);
  const today = dayKey(now);
  const synced = data.earningsSyncedCreatorIds.length > 0 || data.transactions.length > 0;
  const hasTx = data.transactions.length > 0;
  const fansSynced = data.fansSyncedCreatorIds.length > 0;
  const ids = data.creators.map((creator) => creator.id);
  return daysBetween(query.from, query.to).filter((day) => dayStart(day).getTime() < cutAt.getTime()).reverse().map((day) => {
    const sales = all.filter((sale) => sale.day === day);
    const money = (filter: (sale: Sale) => boolean) => (synced ? sumOf(sales.filter(filter), (sale) => pick(sale, query.basis)) : null);
    const subs = money((sale) => sale.channel === "subs");
    const msgs = money((sale) => sale.channel === "messages");
    const start = dayStart(day).getTime();
    const end = dayStart(shiftDay(day, 1)).getTime();
    const newSubs = fansSynced ? data.fans.filter((fan) => fan.subscribedAt && Date.parse(fan.subscribedAt) >= start && Date.parse(fan.subscribedAt) < end).length : null;
    const clickRows = ids.map((id) => snapshotSum(data.snapshots, "link_clicks", id, start, end)).filter((value): value is number => value != null);
    const clicks = clickRows.length > 0 ? sumOf(clickRows, (value) => value) : null;
    return {
      day,
      partial: day >= today,
      totalCents: money(() => true),
      newSubs,
      newSubsCents: hasTx ? money((sale) => sale.kind === "subscription") : null,
      recurringCents: hasTx ? money((sale) => sale.kind === "renewal") : null,
      tipsCents: money((sale) => sale.channel === "tips"),
      messagesCents: msgs,
      chatVsSubs: msgs != null && subs != null && subs > 0 ? msgs / subs : null,
      clicks,
      conversion: clicks != null && clicks > 0 && newSubs != null ? newSubs / clicks : null,
    };
  });
}

// ---------- chatters ----------

export type ChatterRow = {
  userId: string;
  name: string;
  salesCents: number | null;
  ppvSent: number | null;
  ppvBought: number | null;
  conversion: number | null;
  replyMinutes: number | null;
  fansChatted: number | null;
  messagesSent: number | null;
  shiftHours: number | null;
};

/** on: conectado en turno · late: más de 10 min sin entrar · idle: en turno sin conexión reciente · absent: turno de hoy acabado sin entrar. */
export type ShiftNow = { userId: string; name: string; roleLabel: string; status: "on" | "late" | "idle" | "absent"; label: string };

/** Quién está en turno ahora, quién llega tarde y quién faltó hoy (staff_shift, Europe/Madrid). */
export function shiftsNow(staff: readonly InsightStaff[], now: Date): ShiftNow[] {
  const today = madridParts(now);
  const out: ShiftNow[] = [];
  for (const person of staff) {
    for (const back of [0, 1]) {
      const weekday = (today.weekday - back + 7) % 7;
      const slot = person.week.find((item) => item.weekday === weekday);
      if (!slot || slot.off) continue;
      const window = windowStartingOn(slot, addMadridDays(today, -back));
      if (!window || now.getTime() < window.start.getTime()) continue;
      const status: ShiftStatus = cellStatus(slot, person.lastSeenAt, now);
      const inside = now.getTime() < window.end.getTime();
      if (inside) {
        out.push({ userId: person.id, name: person.name, roleLabel: person.roleLabel, status: status === "on" ? "on" : status === "late" ? "late" : "idle", label: shiftLabel(slot) });
        break;
      }
      if (back === 0 && status === "absent") {
        out.push({ userId: person.id, name: person.name, roleLabel: person.roleLabel, status: "absent", label: shiftLabel(slot) });
        break;
      }
    }
  }
  return out;
}

export function chattersOf(data: InsightData, query: InsightQuery, cutAt: Date, now: Date): {
  rows: ChatterRow[];
  series: Array<{ label: string } & Record<string, number | string>>;
  top: Array<{ userId: string; name: string; cents: number }>;
  totalCents: number;
  unattributedCents: number;
  shifts: ShiftNow[];
} {
  const { start, end } = rangeBounds(query.from, query.to, cutAt);
  const days = daysBetween(query.from, query.to);
  const names = new Map(data.staff.map((person) => [person.id, person.name]));
  const amount = (row: InsightAttribution) => (query.basis === "gross" ? row.grossCents : Math.round(row.grossCents * OF_NET_SHARE));
  const sales = data.attributions.filter((row) => {
    const at = Date.parse(row.at);
    return at >= start && at < end;
  });
  const msgs = data.messages.filter((message) => {
    const at = Date.parse(message.at);
    return at >= start && at < end;
  });
  const ids = [...new Set([
    ...sales.flatMap((row) => (row.chatterId ? [row.chatterId] : [])),
    ...msgs.flatMap((message) => (message.authorId ? [message.authorId] : [])),
  ])];
  for (const row of sales) if (row.chatterId && row.chatterName && !names.has(row.chatterId)) names.set(row.chatterId, row.chatterName);
  const rows = ids.map((userId) => {
    const mine = sales.filter((row) => row.chatterId === userId);
    const own = msgs.filter((message) => message.authorId === userId && !message.fromFan);
    const ppv = own.filter((message) => (message.priceCents ?? 0) > 0);
    const bought = ppv.filter((message) => message.purchased === true).length;
    const replies = replyMinutes(msgs, userId);
    const person = data.staff.find((item) => item.id === userId);
    return {
      userId,
      name: names.get(userId) ?? userId,
      salesCents: mine.length > 0 ? sumOf(mine, amount) : null,
      ppvSent: own.length > 0 ? ppv.length : null,
      ppvBought: own.length > 0 ? bought : null,
      conversion: ppv.length > 0 ? bought / ppv.length : null,
      replyMinutes: replies.length > 0 ? Math.round(sumOf(replies, (value) => value) / replies.length) : null,
      fansChatted: own.length > 0 ? new Set(own.map((message) => message.fanKey ?? message.threadKey)).size : null,
      messagesSent: own.length > 0 ? own.length : null,
      shiftHours: person ? scheduledHours(person.week, query.from, query.to) : null,
    };
  }).sort((a, b) => (b.salesCents ?? -1) - (a.salesCents ?? -1));
  const series = days.map((day) => {
    const row: { label: string } & Record<string, number | string> = { label: day };
    for (const id of ids) row[id] = 0;
    for (const sale of sales) {
      if (!sale.chatterId || dayKey(sale.at) !== day) continue;
      row[sale.chatterId] = Number(row[sale.chatterId] ?? 0) + amount(sale);
    }
    return row;
  });
  const top = rows.filter((row) => (row.salesCents ?? 0) > 0).map((row) => ({ userId: row.userId, name: row.name, cents: row.salesCents ?? 0 }));
  const shifts = shiftsNow(data.staff, now);
  return {
    rows,
    series,
    top,
    totalCents: sumOf(sales, amount),
    unattributedCents: sumOf(sales.filter((row) => !row.chatterId), amount),
    shifts,
  };
}

function shiftLabel(slot: ShiftSlot): string {
  const fmt = (minutes: number | null) => (minutes == null ? "--:--" : `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`);
  return `${fmt(slot.startMinutes)}–${fmt(slot.endMinutes)}`;
}

/** Horas de turno programadas en el rango (según el horario semanal guardado). */
export function scheduledHours(week: readonly ShiftSlot[], from: string, to: string): number | null {
  if (week.every((slot) => slot.off)) return null;
  let minutes = 0;
  for (const day of daysBetween(from, to)) {
    const weekday = madridParts(new Date(dayStart(day).getTime() + 12 * 3_600_000)).weekday;
    const slot = week[weekday];
    if (slot && !slot.off) minutes += durationMinutes(slot);
  }
  return Math.round((minutes / 60) * 10) / 10;
}

// ---------- suscriptores nuevos ----------

export type NewSubsView = {
  count: number | null;
  welcome: { replied: number; waiting: number; avgMinutes: number | null; interactionRate: number | null } | null;
  purchase: { bought: number; notBought: number; ratio: number | null } | null;
  duration: { active: number[]; expired: number[]; buckets: string[] } | null;
  segments: Array<{ id: FanSegmentId; count: number }> | null;
};

export const DURATION_BUCKETS = ["< 1 mes", "1–3 meses", "3–6 meses", "6–12 meses", "> 12 meses"];

export function newSubsOf(data: InsightData, query: InsightQuery, cutAt: Date, now: Date): NewSubsView {
  if (data.fansSyncedCreatorIds.length === 0) return { count: null, welcome: null, purchase: null, duration: null, segments: null };
  const { start, end } = rangeBounds(query.from, query.to, cutAt);
  const fresh = data.fans.filter((fan) => fan.subscribedAt && Date.parse(fan.subscribedAt) >= start && Date.parse(fan.subscribedAt) < end);
  let replied = 0;
  let waiting = 0;
  const minutes: number[] = [];
  const hasMessages = data.messages.length > 0;
  if (hasMessages) {
    for (const fan of fresh) {
      const since = Date.parse(fan.subscribedAt ?? "");
      const thread = data.messages
        .filter((message) => message.creatorId === fan.creatorId && message.fanKey === fan.fanKey && Date.parse(message.at) >= since)
        .sort((a, b) => a.at.localeCompare(b.at));
      const welcome = thread.find((message) => !message.fromFan);
      if (!welcome) continue;
      const answer = thread.find((message) => message.fromFan && message.at >= welcome.at);
      if (answer) {
        replied += 1;
        minutes.push((Date.parse(answer.at) - Date.parse(welcome.at)) / 60_000);
      } else waiting += 1;
    }
  }
  const sales = salesOf(data, cutAt).filter((sale) => sale.channel !== "subs" && sale.fanKey);
  const buyers = new Set(sales.map((sale) => `${sale.creatorId}|${sale.fanKey}`));
  const hasTx = data.transactions.length > 0;
  const bought = fresh.filter((fan) => buyers.has(`${fan.creatorId}|${fan.fanKey}`) || ((fan.spentCents ?? 0) > 0 && !hasTx)).length;
  const knownSpend = fresh.filter((fan) => fan.spentCents != null).length;
  const purchase = hasTx || knownSpend > 0
    ? { bought, notBought: fresh.length - bought, ratio: fresh.length > 0 ? bought / fresh.length : null }
    : null;
  const bucketOf = (days: number) => (days < 30 ? 0 : days < 90 ? 1 : days < 180 ? 2 : days < 365 ? 3 : 4);
  const active = [0, 0, 0, 0, 0];
  const expired = [0, 0, 0, 0, 0];
  let durationKnown = false;
  for (const fan of data.fans) {
    const sub = fan.subscribedAt ? Date.parse(fan.subscribedAt) : NaN;
    if (!Number.isFinite(sub)) continue;
    if (fan.status === "active") {
      active[bucketOf((now.getTime() - sub) / DAY_MS)]! += 1;
      durationKnown = true;
    } else if (fan.expiresAt) {
      const until = Date.parse(fan.expiresAt);
      if (!Number.isFinite(until) || until < sub) continue;
      expired[bucketOf((until - sub) / DAY_MS)]! += 1;
      durationKnown = true;
    }
  }
  const counts = countSegments(fresh, now);
  const anySpend = fresh.some((fan) => fan.spentCents != null);
  return {
    count: fresh.length,
    welcome: hasMessages ? { replied, waiting, avgMinutes: minutes.length > 0 ? Math.round(sumOf(minutes, (value) => value) / minutes.length) : null, interactionRate: replied + waiting > 0 ? replied / (replied + waiting) : null } : null,
    purchase,
    duration: durationKnown ? { active, expired, buckets: DURATION_BUCKETS } : null,
    segments: anySpend ? (["whale", "top", "spender", "low", "new"] as FanSegmentId[]).map((id) => ({ id, count: counts[id] })) : null,
  };
}

// ---------- segmentos ----------

export type SegmentFan = {
  creatorId: string;
  creatorName: string;
  fanKey: string;
  name: string;
  handle: string | null;
  spentCents: number | null;
  subscribedAt: string | null;
  status: "active" | "expired";
  segments: FanSegmentId[];
};

export function segmentsOf(data: InsightData, now: Date): { counts: Record<FanSegmentId | "unknown", number> | null; fans: SegmentFan[] } {
  if (data.fansSyncedCreatorIds.length === 0) return { counts: null, fans: [] };
  const names = new Map(data.creators.map((creator) => [creator.id, creator.name]));
  const fans = data.fans.map((fan) => ({
    creatorId: fan.creatorId,
    creatorName: names.get(fan.creatorId) ?? fan.creatorId,
    fanKey: fan.fanKey,
    name: fan.name ?? fan.handle ?? fan.fanKey,
    handle: fan.handle,
    spentCents: fan.spentCents,
    subscribedAt: fan.subscribedAt,
    status: fan.status,
    segments: fanSegments(fan, now),
  })).sort((a, b) => (b.spentCents ?? -1) - (a.spentCents ?? -1));
  return { counts: countSegments(data.fans, now), fans };
}

// ---------- alertas ----------

export type InsightAlert = { kind: "session" | "sync" | "drop" | "whale" | "shift"; level: "alta" | "media"; text: string; action: { label: string; href: string; thread?: { creatorId: string; fanKey: string } } | null };

/**
 * Alertas accionables: bajada de ingresos de una creadora frente al periodo anterior (más del 20 %),
 * fans que gastan mucho (Whale) sin renovación automática, y retrasos de turno.
 */
export function insightAlertsOf(data: InsightData, query: InsightQuery, cutAt: Date, now: Date, money: boolean): InsightAlert[] {
  const alerts: InsightAlert[] = [];
  if (money) {
    const { rows } = creatorRowsOf(data, query, cutAt);
    for (const row of rows) {
      const change = row.changes.total;
      if (change != null && change <= -0.2) {
        alerts.push({ kind: "drop", level: change <= -0.4 ? "alta" : "media", text: `${row.name}: los ingresos bajan un ${Math.round(Math.abs(change) * 100)} % frente al periodo anterior.`, action: { label: "Ver rendimiento", href: `/#rendimiento` } });
      }
    }
  }
  const names = new Map(data.creators.map((creator) => [creator.id, creator.name]));
  for (const fan of data.fans) {
    if (fan.status !== "active" || fan.renewAuto !== false) continue;
    if (spendSegmentOf(fan.spentCents) !== "whale") continue;
    alerts.push({ kind: "whale", level: "alta", text: `${names.get(fan.creatorId) ?? fan.creatorId}: ${fan.name ?? fan.handle ?? fan.fanKey} (Whale) tiene la renovación apagada.`, action: { label: "Ir al chat", href: "/mensajes", thread: { creatorId: fan.creatorId, fanKey: fan.fanKey } } });
  }
  for (const shift of chattersOf(data, query, cutAt, now).shifts) {
    if (shift.status === "late") alerts.push({ kind: "shift", level: "media", text: `${shift.name}: lleva más de 10 minutos de retraso (${shift.label}).`, action: { label: "Ver turnos", href: "/administrar?tab=empleados" } });
    if (shift.status === "absent") alerts.push({ kind: "shift", level: "alta", text: `${shift.name}: ausente en su turno (${shift.label}).`, action: { label: "Ver turnos", href: "/administrar?tab=empleados" } });
  }
  return alerts;
}

export { isNewFan };
