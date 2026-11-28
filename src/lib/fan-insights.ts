import { shownSpendCents } from "./row-spend.ts";

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
  /** Compras de PPV de todo el hilo guardado (avisos, movimientos y mensajes pagados). */
  purchases?: Array<{ sentAt: string; priceCents: number }> | null;
  /** Desglose neto de OnlyFans (`subscribedOnData`). */
  messagesCents?: number | null;
  subscribesCents?: number | null;
  postsCents?: number | null;
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

/** Estado de la suscripción: el de la ficha, o el que sale de la caducidad guardada. */
export function subscriptionStatus(
  status: "active" | "expired" | null,
  expiresAt: string | null,
  now: Date,
): "active" | "expired" | null {
  if (status) return status;
  const time = expiresAt ? Date.parse(expiresAt) : Number.NaN;
  if (!Number.isFinite(time)) return null;
  return time >= now.getTime() ? "active" : "expired";
}

/**
 * Movimientos del fan más las compras de PPV guardadas del hilo.
 * Una compra que ya consta como movimiento de mensaje (mismo día e importe) no se cuenta dos veces.
 */
export function spendRows(
  transactions: InsightSource["transactions"],
  purchases: InsightSource["purchases"],
): InsightSource["transactions"] {
  const rows = [...transactions];
  const seen = new Set(
    transactions.filter((row) => row.kind !== "tip" && row.kind !== "post").map((row) => `${row.occurredAt.slice(0, 10)}:${row.grossCents}`),
  );
  for (const purchase of purchases ?? []) {
    if (purchase.priceCents <= 0 || !purchase.sentAt) continue;
    const key = `${purchase.sentAt.slice(0, 10)}:${purchase.priceCents}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ occurredAt: purchase.sentAt, grossCents: purchase.priceCents, kind: "ppv" });
  }
  return rows;
}

/** Solo usa cifras que ya vienen de OnlyFans o de lo guardado. Lo que falta queda en Sin datos. */
export function fanInsightModel(input: InsightSource): InsightModel {
  const now = input.now ?? new Date();
  const rowsAll = spendRows(input.transactions, input.purchases);
  const tips = rowsAll.filter((row) => row.kind === "tip");
  const tipSum = tips.reduce((sum, row) => sum + row.grossCents, 0);
  const tipsShown = shownSpendCents(input.tipsCents) ?? derivedTipsCents(input);
  const tipTotal = tips.length > 0 ? tipSum : tipsShown;
  const tipAvg = tips.length > 0 && tipTotal != null ? Math.round(tipTotal / tips.length) : null;
  const prices = input.purchases && input.purchases.length > 0 ? input.purchases.map((row) => row.priceCents) : input.ppvPrices;
  const priceSum = prices.reduce((sum, price) => sum + price, 0);
  const ofPpv = shownSpendCents(input.messagesCents ?? null);
  const ppvTotal = prices.length > 0 ? Math.max(priceSum, ofPpv ?? 0) : ofPpv;
  const ppvAvg = prices.length > 0 && ppvTotal != null ? Math.round(ppvTotal / prices.length) : null;
  const last = [...rowsAll].sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))[0] ?? null;
  const max = rowsAll.reduce<{ grossCents: number; occurredAt: string; kind: string } | null>((best, row) => {
    if (!best || row.grossCents > best.grossCents) return { grossCents: row.grossCents, occurredAt: row.occurredAt, kind: row.kind };
    return best;
  }, null);
  const status = subscriptionStatus(input.status, input.expiresAt, now);
  return {
    total: moneyOrEmpty(shownSpendCents(input.spentCents)),
    last: last ? `${moneyOrEmpty(last.grossCents)} · ${last.kind} · ${last.occurredAt.slice(0, 10)}` : "Sin datos",
    ppvTotal: moneyOrEmpty(ppvTotal),
    ppvAvg: moneyOrEmpty(ppvAvg),
    tipTotal: moneyOrEmpty(tipTotal),
    tipAvg: moneyOrEmpty(tipAvg),
    max: max ? `${moneyOrEmpty(max.grossCents)} · ${max.kind} · ${max.occurredAt.slice(0, 10)}` : "Sin datos",
    status: status === "active" ? "Activa" : status === "expired" ? "Caducada" : "Sin datos",
    expires: expiresLabel(input.expiresAt),
    price: moneyOrEmpty(input.subPriceCents),
    renew: input.renewAuto == null ? "Sin datos" : input.renewAuto ? "On" : "Off",
    notes: input.notes.trim() ? input.notes.trim() : "Sin datos",
    lastAgo: last ? agoLabel(last.occurredAt, now) : "Sin datos",
    duration: durationLabel(input.subscribedAt, input.expiresAt),
    power: "Datos insuficientes",
    chargeback: "Desconocido",
  };
}

/** Propinas = total - suscripción - mensajes - posts, solo si OnlyFans dio las tres partes. */
function derivedTipsCents(input: InsightSource): number | null {
  const { spentCents, subscribesCents, messagesCents, postsCents } = input;
  if (spentCents == null || subscribesCents == null || messagesCents == null || postsCents == null) return null;
  const rest = spentCents - subscribesCents - messagesCents - postsCents;
  return rest >= 0 ? shownSpendCents(rest) : null;
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
