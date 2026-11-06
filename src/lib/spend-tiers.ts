/**
 * Tramos del gasto total del fan, en céntimos, de menor a mayor.
 * El color es el del primer tramo cuyo tope cubre el gasto.
 * Cero es gris. Luego verde, azul, morado y dorado.
 */
export const SPEND_TIERS = [
  { untilCents: 0, name: "cero", color: "#6d7585" },
  { untilCents: 5_000, name: "verde", color: "#137333" },
  { untilCents: 20_000, name: "azul", color: "#2456c7" },
  { untilCents: 100_000, name: "morado", color: "#6d28d9" },
  { untilCents: Number.POSITIVE_INFINITY, name: "dorado", color: "#a16207" },
] as const;

export function spendTone(cents: number | null): { label: string; color: string | null } {
  if (cents == null || !Number.isFinite(cents)) return { label: "Sin datos", color: null };
  const tier = SPEND_TIERS.find((item) => cents <= item.untilCents) ?? SPEND_TIERS[SPEND_TIERS.length - 1];
  return { label: `$${(cents / 100).toFixed(2)}`, color: tier?.color ?? null };
}
