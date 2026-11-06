import { SPEND_TIERS } from "../spend-tiers.ts";

/** Mismo corte que el perfil del fan (`whaleCents` por defecto, 100 USD). No es el color dorado. */
export const FAN_WHALE_CENTS = 10_000;

export const COLOR_TIER_NAMES = [
  "cero",
  "verde",
  "azul",
  "morado",
  "dorado",
] as const;

export type ColorTierName = (typeof COLOR_TIER_NAMES)[number];

export type MassSpendTier = ColorTierName | "ballena";

export type SpendWindow = "lifetime" | "spend30";

export type SpendCut = {
  name: string;
  untilCents: number;
};

export function defaultSpendCuts(): SpendCut[] {
  return SPEND_TIERS.map((tier) => ({
    name: tier.name,
    untilCents: tier.untilCents,
  }));
}

export function isMassSpendTier(value: string): value is MassSpendTier {
  return (
    value === "ballena" ||
    (COLOR_TIER_NAMES as readonly string[]).includes(value)
  );
}

export function spendBand(
  cents: number | null,
  cuts: readonly SpendCut[] = defaultSpendCuts(),
): string | null {
  if (cents == null || !Number.isFinite(cents) || cents < 0) return null;
  const tier = cuts.find((item) => cents <= item.untilCents);
  return tier?.name ?? null;
}

export function isWhale(
  cents: number | null,
  whaleCents = FAN_WHALE_CENTS,
): boolean {
  return cents != null && Number.isFinite(cents) && cents >= whaleCents;
}

export function matchesSpendTier(
  cents: number | null,
  tier: MassSpendTier,
  options?: { cuts?: readonly SpendCut[]; whaleCents?: number },
): boolean | null {
  if (cents == null || !Number.isFinite(cents) || cents < 0) return null;
  if (tier === "ballena")
    return isWhale(cents, options?.whaleCents ?? FAN_WHALE_CENTS);
  return spendBand(cents, options?.cuts ?? defaultSpendCuts()) === tier;
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
