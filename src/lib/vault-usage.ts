/** Lo que OnlyFans dijo de un medio. null: la clave no vino. */
export type VaultUsage = {
  posted: boolean | null;
  sent: boolean | null;
  sentCount: number | null;
  priceLabel: string | null;
  dateLabel: string | null;
  seconds: number | null;
  kind: string | null;
};

/** Pastilla visible. null si OnlyFans no dijo que se envió y no hay conteo. */
export function vaultSentPill(sent: boolean | null, sentCount: number | null): string | null {
  if (sent == null && sentCount == null) return null;
  if (sent === false) return null;
  if (sentCount != null) return `Enviado ${sentCount}`;
  return "Enviado";
}

export function vaultUsageText(usage: VaultUsage): string {
  const feed = usage.posted == null ? "Sin datos" : usage.posted ? "Publicado" : "No publicado";
  const sent = usage.sent == null
    ? "Sin datos"
    : usage.sent
      ? usage.sentCount == null ? "Enviado" : `Enviado ${usage.sentCount}`
      : "No enviado";
  const price = usage.priceLabel ?? "Sin datos";
  const date = usage.dateLabel ?? "Sin datos";
  const parts = [`Feed ${feed}`, `Envíos ${sent}`, `Precio ${price}`, `Fecha ${date}`];
  if (usage.kind === "video") parts.push(`Duración ${usage.seconds == null ? "Sin datos" : clock(usage.seconds)}`);
  return parts.join(" · ");
}

function clock(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}
