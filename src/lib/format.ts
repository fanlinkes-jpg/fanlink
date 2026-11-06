/** Importe ya en unidades, siempre $X.XX. */
export function money(n: number) {
  return `$${n.toFixed(2)}`;
}

/** Céntimos de una cifra sincronizada, siempre $X.XX. */
export function formatCents(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

export function pct(ratio: number) {
  return new Intl.NumberFormat("es-ES", {
    style: "percent",
    maximumFractionDigits: 0,
  }).format(ratio);
}

export function isLast24h(ts: number) {
  return Date.now() - ts < 24 * 60 * 60 * 1000;
}

export function timeAgo(ts: number) {
  const min = Math.max(0, Math.round((Date.now() - ts) / 60000));
  if (min < 1) return "ahora";
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  return `hace ${d} d`;
}

export function clock(ts: number) {
  return new Intl.DateTimeFormat("es-ES", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(ts);
}
