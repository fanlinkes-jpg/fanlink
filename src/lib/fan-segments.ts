/**
 * Segmentos de fan por gasto total (en céntimos de dólar) y antigüedad de la suscripción.
 * Acordados con FANLINK:
 *   Freeloader   0 $ (nunca compró)
 *   Low spender  de 1 a 50 $     (más de 0 y como mucho 50)
 *   Spender      de 51 a 100 $   (más de 50 y como mucho 100)
 *   Top spender  de 101 a 200 $  (más de 100 y como mucho 200)
 *   Whale        201 $ o más     (más de 200)
 *   New          suscrito en los últimos 30 días (se suma al tramo de gasto)
 * Un importe entre dos enteros (p. ej. 50,50 $) va al tramo inferior de la frontera:
 * Low ≤ 50, Spender > 50 y ≤ 100, Top > 100 y ≤ 200, Whale > 200.
 * Sin gasto conocido no hay tramo: «Sin datos». Un cero no se inventa.
 */
export const SPEND_SEGMENTS = [
  { id: "whale", label: "Whale", minCents: 20_001, maxCents: null, detail: "201 $ o más" },
  { id: "top", label: "Top spender", minCents: 10_001, maxCents: 20_000, detail: "De 101 a 200 $" },
  { id: "spender", label: "Spender", minCents: 5_001, maxCents: 10_000, detail: "De 51 a 100 $" },
  { id: "low", label: "Low spender", minCents: 1, maxCents: 5_000, detail: "De 1 a 50 $" },
  { id: "freeloader", label: "Freeloader", minCents: 0, maxCents: 0, detail: "0 $ · nunca compró" },
] as const;

export type SpendSegmentId = (typeof SPEND_SEGMENTS)[number]["id"];
export type FanSegmentId = SpendSegmentId | "new";

export const FAN_SEGMENT_IDS: readonly FanSegmentId[] = ["whale", "top", "spender", "low", "freeloader", "new"];

export const NEW_FAN_DAYS = 30;
const DAY_MS = 86_400_000;

export function segmentLabel(id: FanSegmentId): string {
  if (id === "new") return "New";
  return SPEND_SEGMENTS.find((segment) => segment.id === id)?.label ?? id;
}

export function segmentDetail(id: FanSegmentId): string {
  if (id === "new") return `Suscrito en los últimos ${NEW_FAN_DAYS} días`;
  return SPEND_SEGMENTS.find((segment) => segment.id === id)?.detail ?? "";
}

export function isFanSegmentId(value: unknown): value is FanSegmentId {
  return typeof value === "string" && (FAN_SEGMENT_IDS as readonly string[]).includes(value);
}

/** Tramo de gasto. Null si OnlyFans no dio el gasto. 0 $ confirmado es Freeloader, no «Sin datos». */
export function spendSegmentOf(spentCents: number | null | undefined): SpendSegmentId | null {
  if (spentCents == null || !Number.isFinite(spentCents) || spentCents < 0) return null;
  if (spentCents === 0) return "freeloader";
  if (spentCents <= 5_000) return "low";
  if (spentCents <= 10_000) return "spender";
  if (spentCents <= 20_000) return "top";
  return "whale";
}

/** Nuevo: suscrito hace 30 días o menos. Sin fecha de suscripción no es nuevo. */
export function isNewFan(subscribedAt: string | null | undefined, now: Date): boolean {
  if (!subscribedAt) return false;
  const at = Date.parse(subscribedAt);
  if (!Number.isFinite(at)) return false;
  const age = now.getTime() - at;
  return age >= 0 && age <= NEW_FAN_DAYS * DAY_MS;
}

/** Todos los segmentos del fan: su tramo de gasto y, si toca, New. */
export function fanSegments(fan: { spentCents: number | null | undefined; subscribedAt: string | null | undefined }, now: Date): FanSegmentId[] {
  const out: FanSegmentId[] = [];
  const tier = spendSegmentOf(fan.spentCents);
  if (tier) out.push(tier);
  if (isNewFan(fan.subscribedAt, now)) out.push("new");
  return out;
}

export function inSegment(fan: { spentCents: number | null | undefined; subscribedAt: string | null | undefined }, segment: FanSegmentId, now: Date): boolean {
  return fanSegments(fan, now).includes(segment);
}

/** Recuento por segmento. `unknown` son fans sin gasto conocido. */
export function countSegments(
  fans: ReadonlyArray<{ spentCents: number | null | undefined; subscribedAt: string | null | undefined }>,
  now: Date,
): Record<FanSegmentId | "unknown", number> {
  const counts: Record<FanSegmentId | "unknown", number> = { whale: 0, top: 0, spender: 0, low: 0, freeloader: 0, new: 0, unknown: 0 };
  for (const fan of fans) {
    const tier = spendSegmentOf(fan.spentCents);
    if (tier) counts[tier] += 1;
    else counts.unknown += 1;
    if (isNewFan(fan.subscribedAt, now)) counts.new += 1;
  }
  return counts;
}

/** Filtro de listas y masivos: «all» deja pasar a todos; si no, el fan tiene que estar en ese segmento. */
export function matchesSegmentFilter(
  filter: FanSegmentId | "all",
  fan: { spentCents: number | null | undefined; subscribedAt: string | null | undefined },
  now: Date,
): boolean {
  if (filter === "all") return true;
  return inSegment(fan, filter, now);
}
