export type InsightSource = {
  spentCents: number | null;
  tipsCents: number | null;
  status: "active" | "expired" | null;
  expiresAt: string | null;
  renewAuto: boolean | null;
  subPriceCents: number | null;
  notes: string;
  subscribedAt?: string | null;
  now?: Date;
  transactions: Array<{ occurredAt: string; grossCents: number; kind: string }>;
  ppvPrices: number[];
};

export type InsightModel = {
  total: string;
  last: string;
  ppvTotal: string;
  ppvAvg: string;
  tipTotal: string;
  tipAvg: string;
  max: string;
  status: string;
  expires: string;
  price: string;
  renew: string;
  notes: string;
  lastAgo: string;
  duration: string;
  power: string;
  chargeback: string;
};

export function moneyOrEmpty(cents: number | null): string {
  if (cents == null) return "Sin datos";
  return `$${(cents / 100).toFixed(2)}`;
}

/** Solo usa cifras que ya vienen de OnlyFans. Lo que falta queda en Sin datos. */
export function fanInsightModel(input: InsightSource): InsightModel {
  const tips = input.transactions.filter((row) => row.kind === "tip");
  const tipSum = tips.reduce((sum, row) => sum + row.grossCents, 0);
  const tipTotal = tips.length > 0 ? tipSum : input.tipsCents;
  const tipAvg = tips.length > 0 && tipTotal != null ? Math.round(tipTotal / tips.length) : null;
  const ppvSum = input.ppvPrices.reduce((sum, price) => sum + price, 0);
  const ppvTotal = input.ppvPrices.length > 0 ? ppvSum : null;
  const ppvAvg = input.ppvPrices.length > 0 ? Math.round(ppvSum / input.ppvPrices.length) : null;
  const last = [...input.transactions].sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))[0] ?? null;
  const max = input.transactions.reduce<{ grossCents: number; occurredAt: string; kind: string } | null>((best, row) => {
    if (!best || row.grossCents > best.grossCents) return { grossCents: row.grossCents, occurredAt: row.occurredAt, kind: row.kind };
    return best;
  }, null);
  return {
    total: moneyOrEmpty(input.spentCents),
    last: last ? `${moneyOrEmpty(last.grossCents)} · ${last.kind} · ${last.occurredAt.slice(0, 10)}` : "Sin datos",
    ppvTotal: moneyOrEmpty(ppvTotal),
    ppvAvg: moneyOrEmpty(ppvAvg),
    tipTotal: moneyOrEmpty(tipTotal),
    tipAvg: moneyOrEmpty(tipAvg),
    max: max ? `${moneyOrEmpty(max.grossCents)} · ${max.kind} · ${max.occurredAt.slice(0, 10)}` : "Sin datos",
    status: input.status === "active" ? "Activa" : input.status === "expired" ? "Caducada" : "Sin datos",
    expires: expiresLabel(input.expiresAt),
    price: moneyOrEmpty(input.subPriceCents),
    renew: input.renewAuto == null ? "Sin datos" : input.renewAuto ? "On" : "Off",
    notes: input.notes.trim() ? input.notes.trim() : "Sin datos",
    lastAgo: last ? agoLabel(last.occurredAt, input.now ?? new Date()) : "Sin datos",
    duration: durationLabel(input.subscribedAt, input.expiresAt),
    power: "Datos insuficientes",
    chargeback: "Desconocido",
  };
}

function expiresLabel(iso: string | null): string {
  if (!iso) return "Sin datos";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Sin datos";
  const formatted = new Intl.DateTimeFormat("es-ES", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Europe/Madrid",
  }).format(date);
  return `Caduca: ${formatted}`;
}

function agoLabel(iso: string, now: Date): string {
  const ms = now.getTime() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return "Sin datos";
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 48) return `hace ${hours} h`;
  return `hace ${Math.floor(hours / 24)} d`;
}

function durationLabel(start: string | null | undefined, end: string | null): string {
  if (!start || !end) return "Sin datos";
  const ms = Date.parse(end) - Date.parse(start);
  if (!Number.isFinite(ms) || ms <= 0) return "Sin datos";
  return `${Math.round(ms / 86_400_000)} días`;
}
