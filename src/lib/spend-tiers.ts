/**
 * Tramos de gasto para audiencias de masivos.
 * Los importes son céntimos de USD, como `spent_cents` y las transacciones.
 * Ballena empieza en el mismo umbral que el perfil del fan (`whaleCents`, 100 USD).
 * Los cortes intermedios son de Fanlink: no son categorías de OnlyFans.
 */
export const WHALE_CENTS = 10_000;

export const SPEND_TIER_IDS = [
  "ballena",
  "alto",
  "medio",
  "bajo",
  "sin_compra",
] as const;

export type SpendTierId = (typeof SPEND_TIER_IDS)[number];

export type SpendWindow = "lifetime" | "spend30";

export type SpendTier = {
  id: SpendTierId;
  label: string;
  /** Inclusivo, en céntimos. */
  minCents: number;
  /** Exclusivo. Null si no hay techo. */
  maxCents: number | null;
};

export const SPEND_TIERS: readonly SpendTier[] = [
  { id: "ballena", label: "Ballena", minCents: WHALE_CENTS, maxCents: null },
  { id: "alto", label: "Gasto alto", minCents: 5_000, maxCents: WHALE_CENTS },
  { id: "medio", label: "Gasto medio", minCents: 2_000, maxCents: 5_000 },
  { id: "bajo", label: "Gasto bajo", minCents: 1, maxCents: 2_000 },
  { id: "sin_compra", label: "Sin compra", minCents: 0, maxCents: 1 },
];

export function isSpendTierId(value: string): value is SpendTierId {
  return (SPEND_TIER_IDS as readonly string[]).includes(value);
}

export function spendTierFor(cents: number | null): SpendTierId | null {
  if (cents == null || !Number.isFinite(cents) || cents < 0) return null;
  if (cents === 0) return "sin_compra";
  if (cents >= WHALE_CENTS) return "ballena";
  if (cents >= 5_000) return "alto";
  if (cents >= 2_000) return "medio";
  return "bajo";
}

export function spendAmount(
  fan: { spentCents: number | null; spend30Cents: number | null },
  window: SpendWindow,
): number | null {
  switch (window) {
    case "lifetime":
      return fan.spentCents;
    case "spend30":
      return fan.spend30Cents;
    default: {
      const exhaustive: never = window;
      throw new Error(`Ventana de gasto no cubierta: ${String(exhaustive)}`);
    }
  }
}
