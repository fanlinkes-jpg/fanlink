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
  const grossCents = txs.length > 0 ? sum(txs, (row) => row.grossCents) : input.earningsSynced ? chartGross(input.earnings, start, end) : null;
  const previousGrossCents = previousTxs.length > 0
    ? sum(previousTxs, (row) => row.grossCents)
    : input.earningsSynced
      ? chartGross(input.earnings, previousStart, start)
      : null;
  const netCents = periodNet(txs);
  const previousNetCents = periodNet(previousTxs);
  const byKind = txs.length > 0 ? kindBreakdown(txs) : [];
  const series = txs.length > 0 ? seriesFrom(txs, start, end) : input.earningsSynced ? seriesFromEarnings(input.earnings, start, end) : [];
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

const MADRID = "Europe/Madrid";

function bounds(now: Date, period: MetricPeriod): { start: Date; end: Date; previousStart: Date } {
  const end = new Date(now);
  const today = madridParts(now);
  if (period === "day") {
    const start = madridMidnight(today.year, today.month, today.day);
    const previous = madridParts(new Date(start.getTime() - 86_400_000));
    return { start, end, previousStart: madridMidnight(previous.year, previous.month, previous.day) };
  }
  if (period === "week") {
    const start = madridMidnight(today.year, today.month, today.day - 6);
    const previous = madridParts(new Date(start.getTime() - 7 * 86_400_000));
    return { start, end, previousStart: madridMidnight(previous.year, previous.month, previous.day) };
  }
  const start = madridMidnight(today.year, today.month, 1);
  const previous = madridParts(new Date(start.getTime() - 86_400_000));
  return { start, end, previousStart: madridMidnight(previous.year, previous.month, 1) };
}

function madridParts(date: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: MADRID,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const pick = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return { year: pick("year"), month: pick("month"), day: pick("day") };
}

function madridOffsetMs(utcMs: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: MADRID,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const pick = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const asUtc = Date.UTC(pick("year"), pick("month") - 1, pick("day"), pick("hour"), pick("minute"), pick("second"));
  return asUtc - utcMs;
}

function madridMidnight(year: number, month: number, day: number): Date {
  const guess = Date.UTC(year, month - 1, day);
  return new Date(guess - madridOffsetMs(guess));
}

function madridDay(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: MADRID, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

function periodNet(rows: MetricTx[]): number | null {
  if (rows.length === 0 || rows.some((row) => row.netCents == null)) return null;
  return sum(rows, (row) => row.netCents ?? 0);
}

function inRange(iso: string, start: Date, end: Date): boolean {
  const time = Date.parse(iso);
  return Number.isFinite(time) && time >= start.getTime() && time < end.getTime();
}

function sum<T>(rows: T[], pick: (row: T) => number): number {
  return rows.reduce((total, row) => total + pick(row), 0);
}

function chartGross(rows: MetricEarning[], start: Date, end: Date): number {
  const first = madridDay(start.toISOString());
  const last = madridDay(new Date(end.getTime() - 1).toISOString());
  const inside = (day: string) => day >= first && day <= last;
  const parts = rows.filter((row) => row.kind !== "total" && inside(row.day));
  const totals = rows.filter((row) => row.kind === "total" && inside(row.day));
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

function seriesFrom(rows: MetricTx[], start: Date, end: Date): Array<{ label: string; grossCents: number; netCents: number | null }> {
  const buckets = new Map<string, MetricTx[]>();
  for (const row of rows) {
    const label = madridDay(row.occurredAt);
    const list = buckets.get(label) ?? [];
    list.push(row);
    buckets.set(label, list);
  }
  return fillDays(start, end).map((label) => {
    const list = buckets.get(label) ?? [];
    return {
      label,
      grossCents: list.reduce((total, row) => total + row.grossCents, 0),
      netCents: periodNet(list),
    };
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
  const last = madridDay(new Date(end.getTime() - 1).toISOString());
  let cursor = madridDay(start.toISOString());
  while (cursor <= last && days.length < 40) {
    days.push(cursor);
    const [year, month, day] = cursor.split("-").map(Number);
    cursor = madridDay(madridMidnight(year ?? 2026, month ?? 1, (day ?? 1) + 1).toISOString());
  }
  return days;
}
