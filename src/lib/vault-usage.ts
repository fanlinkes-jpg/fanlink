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
  const parts: string[] = [];
  if (usage.posted != null) parts.push(`Feed ${usage.posted ? "Publicado" : "No publicado"}`);
  if (usage.sent != null || (usage.sentCount != null && usage.sent !== false)) {
    const sent = usage.sent === false
      ? "No enviado"
      : usage.sentCount == null ? "Enviado" : `Enviado ${usage.sentCount}`;
    parts.push(`Envíos ${sent}`);
  }
  if (usage.priceLabel && usage.priceLabel !== "Sin datos") parts.push(`Precio ${usage.priceLabel}`);
  if (usage.dateLabel && usage.dateLabel !== "Sin datos") parts.push(`Fecha ${usage.dateLabel}`);
  if (usage.kind === "video" && usage.seconds != null) parts.push(`Duración ${clock(usage.seconds)}`);
  return parts.join(" · ");
}

function clock(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}
