export type InsightSource = {
  spentCents: number | null;
  tipsCents: number | null;
  status: "active" | "expired" | null;
  expiresAt: string | null;
  renewAuto: boolean | null;
  subPriceCents: number | null;
  notes: string;
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
};

export function moneyOrEmpty(cents: number | null): string {
  if (cents == null) return "Sin datos";
  return `${(cents / 100).toFixed(2)} USD`;
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
  const max = input.transactions.reduce<{ grossCents: number; occurredAt: string } | null>((best, row) => {
    if (!best || row.grossCents > best.grossCents) return { grossCents: row.grossCents, occurredAt: row.occurredAt };
    return best;
  }, null);
  return {
    total: moneyOrEmpty(input.spentCents),
    last: last ? `${moneyOrEmpty(last.grossCents)} · ${last.kind} · ${last.occurredAt.slice(0, 10)}` : "Sin datos",
    ppvTotal: moneyOrEmpty(ppvTotal),
    ppvAvg: moneyOrEmpty(ppvAvg),
    tipTotal: moneyOrEmpty(tipTotal),
    tipAvg: moneyOrEmpty(tipAvg),
    max: max ? `${moneyOrEmpty(max.grossCents)} · ${max.occurredAt.slice(0, 10)}` : "Sin datos",
    status: input.status === "active" ? "Activa" : input.status === "expired" ? "Caducada" : "Sin datos",
    expires: input.expiresAt?.slice(0, 10) ?? "Sin datos",
    price: moneyOrEmpty(input.subPriceCents),
    renew: input.renewAuto == null ? "Sin datos" : input.renewAuto ? "Sí" : "No",
    notes: input.notes.trim() ? input.notes.trim() : "Sin datos",
  };
}
