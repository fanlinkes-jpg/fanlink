export type MetricPeriod = "day" | "week" | "month";

export type MetricTx = {
  occurredAt: string;
  grossCents: number;
  netCents: number | null;
  kind: string;
};

export type MetricEarning = { day: string; kind: string; amountCents: number };

export type MetricFan = {
  status: "active" | "expired";
  subscribedAt: string | null;
  renewAuto: boolean | null;
};

export type CreatorMetricReport = {
  grossCents: number | null;
  netCents: number | null;
  previousGrossCents: number | null;
  previousNetCents: number | null;
  byKind: Array<{ kind: string; grossCents: number }>;
  series: Array<{ label: string; grossCents: number; netCents: number | null }>;
  activeFans: number | null;
  newFans: number | null;
  expiredFans: number | null;
  renewalRatio: number | null;
  arpuCents: number | null;
};

const PART_KINDS = new Set(["subscription", "tip", "message", "post", "renewal", "stream", "referral"]);

export function creatorReport(input: {
  now: Date;
  period: MetricPeriod;
  transactions: MetricTx[];
  earnings: MetricEarning[];
  fans: MetricFan[];
  earningsSynced: boolean;
  fansSynced: boolean;
}): CreatorMetricReport {
  const { start, end, previousStart } = bounds(input.now, input.period);
  const txs = input.transactions.filter((row) => inRange(row.occurredAt, start, end));
  const previousTxs = input.transactions.filter((row) => inRange(row.occurredAt, previousStart, start));
  const hasTx = input.transactions.length > 0;
  const grossCents = hasTx ? sum(txs, (row) => row.grossCents) : input.earningsSynced ? chartGross(input.earnings, start, end) : null;
  const previousGrossCents = hasTx
    ? sum(previousTxs, (row) => row.grossCents)
    : input.earningsSynced
      ? chartGross(input.earnings, previousStart, start)
      : null;
  const netKnown = hasTx && txs.some((row) => row.netCents != null);
  const previousNetKnown = hasTx && previousTxs.some((row) => row.netCents != null);
  const netCents = netKnown ? sum(txs.filter((row) => row.netCents != null), (row) => row.netCents ?? 0) : null;
  const previousNetCents = previousNetKnown
    ? sum(previousTxs.filter((row) => row.netCents != null), (row) => row.netCents ?? 0)
    : null;
  const byKind = hasTx ? kindBreakdown(txs) : [];
  const series = hasTx ? seriesFrom(txs, start, end, input.period) : input.earningsSynced ? seriesFromEarnings(input.earnings, start, end) : [];
  const activeFans = input.fansSynced ? input.fans.filter((fan) => fan.status === "active").length : null;
  const expiredFans = input.fansSynced ? input.fans.filter((fan) => fan.status === "expired").length : null;
  const newFans = input.fansSynced
    ? input.fans.filter((fan) => fan.subscribedAt != null && inRange(fan.subscribedAt, start, end)).length
    : null;
  const knownRenew = input.fans.filter((fan) => fan.renewAuto != null);
  const renewalRatio = input.fansSynced && knownRenew.length > 0
    ? knownRenew.filter((fan) => fan.renewAuto === true).length / knownRenew.length
    : null;
  const arpuCents = grossCents != null && activeFans != null && activeFans > 0 ? Math.round(grossCents / activeFans) : null;
  return {
    grossCents,
    netCents,
    previousGrossCents,
    previousNetCents,
    byKind,
    series,
    activeFans,
    newFans,
    expiredFans,
    renewalRatio,
    arpuCents,
  };
}

export function changeRatio(current: number | null, previous: number | null): number | null {
  if (current == null || previous == null || previous === 0) return null;
  return (current - previous) / previous;
}

function bounds(now: Date, period: MetricPeriod): { start: Date; end: Date; previousStart: Date } {
  const end = new Date(now);
  if (period === "day") {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    return { start, end, previousStart: new Date(start.getTime() - 86_400_000) };
  }
  if (period === "week") {
    const start = new Date(end.getTime() - 7 * 86_400_000);
    return { start, end, previousStart: new Date(start.getTime() - 7 * 86_400_000) };
  }
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const previousStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return { start, end, previousStart };
}

function inRange(iso: string, start: Date, end: Date): boolean {
  const time = Date.parse(iso);
  return Number.isFinite(time) && time >= start.getTime() && time < end.getTime();
}

function sum<T>(rows: T[], pick: (row: T) => number): number {
  return rows.reduce((total, row) => total + pick(row), 0);
}

function chartGross(rows: MetricEarning[], start: Date, end: Date): number {
  const parts = rows.filter((row) => row.kind !== "total" && inRange(`${row.day}T00:00:00.000Z`, start, end));
  const totals = rows.filter((row) => row.kind === "total" && inRange(`${row.day}T00:00:00.000Z`, start, end));
  const source = parts.length > 0 ? parts : totals;
  return source.reduce((total, row) => total + row.amountCents, 0);
}

function kindBreakdown(rows: MetricTx[]): Array<{ kind: string; grossCents: number }> {
  const map = new Map<string, number>();
  for (const row of rows) {
    if (!PART_KINDS.has(row.kind)) continue;
    map.set(row.kind, (map.get(row.kind) ?? 0) + row.grossCents);
  }
  return [...map.entries()].map(([kind, grossCents]) => ({ kind, grossCents })).sort((a, b) => b.grossCents - a.grossCents);
}

function seriesFrom(rows: MetricTx[], start: Date, end: Date, period: MetricPeriod): Array<{ label: string; grossCents: number; netCents: number | null }> {
  const buckets = new Map<string, { gross: number; net: number; netSeen: boolean }>();
  for (const row of rows) {
    const label = period === "month" ? row.occurredAt.slice(0, 10) : row.occurredAt.slice(0, 10);
    const slot = buckets.get(label) ?? { gross: 0, net: 0, netSeen: false };
    slot.gross += row.grossCents;
    if (row.netCents != null) {
      slot.net += row.netCents;
      slot.netSeen = true;
    }
    buckets.set(label, slot);
  }
  return fillDays(start, end).map((label) => {
    const slot = buckets.get(label);
    return { label, grossCents: slot?.gross ?? 0, netCents: slot?.netSeen ? slot.net : null };
  });
}

function seriesFromEarnings(rows: MetricEarning[], start: Date, end: Date): Array<{ label: string; grossCents: number; netCents: number | null }> {
  return fillDays(start, end).map((label) => ({
    label,
    grossCents: chartGross(rows.filter((row) => row.day === label), start, end),
    netCents: null,
  }));
}

function fillDays(start: Date, end: Date): string[] {
  const days: string[] = [];
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  const last = new Date(end.getTime() - 1);
  while (cursor.getTime() <= last.getTime() && days.length < 40) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}
