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
  /** Puesto del gasto entre los hilos de la creadora. */
  rank?: { fans: number; above: number; mineCents: number } | null;
  /** Contracargos guardados. Null si no se han leído. */
  chargebacks?: number | null;
  /** Inicio de la suscripción y duración en meses que dio OnlyFans. */
  subMonths?: number | null;
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
 * Una compra que ya consta como movimiento de mensaje (mismo importe, a menos de 2 días) no se cuenta dos veces.
 */
export function spendRows(
  transactions: InsightSource["transactions"],
  purchases: InsightSource["purchases"],
): InsightSource["transactions"] {
  const rows = [...transactions];
  const paid = transactions.filter((row) => row.kind !== "tip" && row.kind !== "post");
  const used = new Set<number>();
  for (const purchase of purchases ?? []) {
    if (purchase.priceCents <= 0 || !purchase.sentAt) continue;
    const time = Date.parse(purchase.sentAt);
    const index = paid.findIndex((row, at) => !used.has(at) && row.grossCents === purchase.priceCents && Math.abs(Date.parse(row.occurredAt) - time) <= 2 * 86_400_000);
    if (index >= 0) {
      used.add(index);
      continue;
    }
    rows.push({ occurredAt: purchase.sentAt, grossCents: purchase.priceCents, kind: "ppv" });
  }
  return rows;
}

const KIND_LABEL: Record<string, string> = { tip: "Tip", message: "PPV", ppv: "PPV", post: "Post" };

export function kindLabel(kind: string): string {
  return KIND_LABEL[kind] ?? kind;
}

/** Fecha corta como Infloww: Oct 16, 2026, en hora de Madrid. */
export function shortDate(iso: string): string {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return "Sin datos";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "Europe/Madrid" }).format(new Date(time));
}

/** Solo usa cifras que ya vienen de OnlyFans o de lo guardado. Lo que falta queda en Sin datos. */
export function fanInsightModel(input: InsightSource): InsightModel {
  const now = input.now ?? new Date();
  const rowsAll = spendRows(input.transactions, input.purchases);
  const spentKnown = input.spentCents != null;
  const tips = rowsAll.filter((row) => row.kind === "tip");
  const tipSum = tips.reduce((sum, row) => sum + row.grossCents, 0);
  const tipsShown = shownSpendCents(input.tipsCents) ?? derivedTipsCents(input);
  // Con gasto guardado y sin una sola propina en ninguna fuente, las propinas son 0.
  const tipTotal = tips.length > 0 ? tipSum : tipsShown ?? (spentKnown ? 0 : null);
  const tipAvg = tips.length > 0 && tipTotal != null ? Math.round(tipTotal / tips.length) : null;
  const purchases = input.purchases ?? null;
  const prices = purchases && purchases.length > 0 ? purchases.map((row) => row.priceCents) : input.ppvPrices;
  const priceSum = prices.reduce((sum, price) => sum + price, 0);
  const ofPpv = shownSpendCents(input.messagesCents ?? null);
  // El total de mensajes de OnlyFans manda (es lo que enseña Infloww); sin él, la suma de compras.
  const ppvTotal = ofPpv != null && (ofPpv > 0 || prices.length === 0)
    ? ofPpv
    : prices.length > 0 ? priceSum : purchases && spentKnown ? 0 : null;
  const ppvAvg = prices.length > 0 && ppvTotal != null ? Math.round(ppvTotal / prices.length) : null;
  const posts = shownSpendCents(input.postsCents ?? null) ?? 0;
  // Como Infloww: PPV + propinas (+ posts). La suscripción no entra. Sin las dos cifras, el total de OnlyFans.
  const total = ppvTotal != null && tipTotal != null ? ppvTotal + tipTotal + posts : shownSpendCents(input.spentCents);
  const last = [...rowsAll].sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))[0] ?? null;
  const max = rowsAll.reduce<{ grossCents: number; occurredAt: string; kind: string } | null>((best, row) => {
    if (!best || row.grossCents > best.grossCents) return { grossCents: row.grossCents, occurredAt: row.occurredAt, kind: row.kind };
    return best;
  }, null);
  const status = subscriptionStatus(input.status, input.expiresAt, now);
  return {
    total: moneyOrEmpty(total),
    last: last ? `${kindLabel(last.kind)} ${moneyOrEmpty(last.grossCents)}` : "Sin datos",
    ppvTotal: moneyOrEmpty(ppvTotal),
    ppvAvg: ppvTotal === 0 && prices.length === 0 ? "-" : moneyOrEmpty(ppvAvg),
    tipTotal: moneyOrEmpty(tipTotal),
    tipAvg: tipTotal === 0 && tips.length === 0 ? "-" : moneyOrEmpty(tipAvg),
    max: max ? `${moneyOrEmpty(max.grossCents)} · ${kindLabel(max.kind)} · ${shortDate(max.occurredAt)}` : "Sin datos",
    status: status === "active" ? "Activa" : status === "expired" ? "Caducada" : "Sin datos",
    expires: expiresLabel(input.expiresAt),
    price: moneyOrEmpty(input.subPriceCents),
    renew: input.renewAuto == null ? "Sin datos" : input.renewAuto ? "On" : "Off",
    notes: input.notes.trim() ? input.notes.trim() : "Sin datos",
    lastAgo: last ? agoLabel(last.occurredAt, now) : "Sin datos",
    duration: durationLabel(input.subscribedAt, input.expiresAt, input.subMonths ?? null, now),
    power: spendingPower(input.rank ?? null),
    chargeback: chargebackRisk(input.chargebacks ?? null, spentKnown),
  };
}

/** Top N %: cuántos fans de la creadora gastan más que este, sobre los que tienen gasto guardado. */
export function spendingPower(rank: { fans: number; above: number; mineCents: number } | null): string {
  if (!rank || rank.fans < 5) return "Datos insuficientes";
  const percent = Math.max(1, Math.ceil(((rank.above + 1) / rank.fans) * 100));
  return `Top ${percent}%`;
}

/** Low si hay gasto guardado y ningún contracargo; High con alguno. Sin gasto guardado, Desconocido. */
export function chargebackRisk(chargebacks: number | null, spentKnown: boolean): string {
  if (chargebacks == null || !spentKnown) return "Desconocido";
  return chargebacks > 0 ? "High" : "Low";
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

/** Como Infloww: 5min ago, 3h ago, 12d ago, 1m ago (meses), 2y ago. */
export function agoLabel(iso: string, now: Date): string {
  const ms = now.getTime() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return "Sin datos";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${Math.max(1, minutes)}min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}m ago`;
  return `${Math.floor(days / 365)}y ago`;
}

/** Desde el inicio de la suscripción: meses (1 mes, 3 meses) o días si no llega a un mes. Sin inicio, la duración de OnlyFans. */
export function durationLabel(start: string | null | undefined, end: string | null, months: number | null = null, now: Date = new Date()): string {
  const started = start ? Date.parse(start) : Number.NaN;
  if (Number.isFinite(started) && started <= now.getTime()) {
    const days = Math.floor((now.getTime() - started) / 86_400_000);
    if (days < 30) return `${Math.max(days, 1)} ${days <= 1 ? "día" : "días"}`;
    const whole = Math.floor(days / 30);
    return `${whole} ${whole === 1 ? "mes" : "meses"}`;
  }
  if (months != null && months > 0) return `${months} ${months === 1 ? "mes" : "meses"}`;
  const ended = end ? Date.parse(end) : Number.NaN;
  if (Number.isFinite(started) && Number.isFinite(ended) && ended > started) return `${Math.round((ended - started) / 86_400_000)} días`;
  return "Sin datos";
}
