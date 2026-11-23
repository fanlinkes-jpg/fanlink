/** Hilo, luego ficha, luego lo pedido aparte. Un 0 real no se salta. */
export function rowSpendCents(thread: number | null, card: number | null, fetched: number | null): number | null {
  return thread ?? card ?? fetched ?? null;
}

/**
 * `totalSumm` es el neto, después del 20 % de OnlyFans.
 * Infloww y OnlyFans enseñan el bruto. Si hay un bruto ya contado, se usa.
 * Si no, neto / 0.8 redondeado al céntimo. 8477 → 10596 ($105.96).
 */
export function shownSpendCents(netCents: number | null, earningsCents: number | null = null): number | null {
  if (earningsCents != null && Number.isFinite(earningsCents) && earningsCents >= 0) return Math.round(earningsCents);
  if (netCents == null || !Number.isFinite(netCents)) return null;
  if (netCents <= 0) return netCents;
  return Math.round(netCents / 0.8);
}

export function spendLogLine(input: {
  creatorId: string;
  thread: number;
  card: number;
  subscribers: number;
  users: number;
  stillNull: number;
}): string {
  return `[fanlink:spend] creator=${input.creatorId} thread=${input.thread} card=${input.card} subscribers=${input.subscribers} users=${input.users} still null=${input.stillNull}`;
}
