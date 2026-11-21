/** Lo que OnlyFans dijo de un medio. null: la clave no vino. */
export type VaultUsage = {
  posted: boolean | null;
  sent: boolean | null;
  sentCount: number | null;
  priceCents: number | null;
  dateLabel: string | null;
  seconds: number | null;
  kind: string | null;
};

export function vaultUsageText(usage: VaultUsage): string {
  const feed = usage.posted == null ? "Sin datos" : usage.posted ? "Posted" : "No publicado";
  const sent = usage.sent == null
    ? "Sin datos"
    : usage.sent
      ? usage.sentCount == null ? "Sent · Sin datos" : `Sent ${usage.sentCount}`
      : "No enviado";
  const price = usage.priceCents == null ? "Sin datos" : usage.priceCents <= 0 ? "Free" : `$${(usage.priceCents / 100).toFixed(2)}`;
  const date = usage.dateLabel ?? "Sin datos";
  const parts = [`Feed ${feed}`, `Envíos ${sent}`, `Precio ${price}`, `Fecha ${date}`];
  if (usage.kind === "video") parts.push(`Duración ${usage.seconds == null ? "Sin datos" : clock(usage.seconds)}`);
  return parts.join(" · ");
}

function clock(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}
