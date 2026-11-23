/** Punto verde, como OnlyFans, solo cuando la ficha dice que el fan está en línea. */
export function showOnlineDot(online: boolean | null | undefined): boolean {
  return online === true;
}

/** «Visto hace X» cuando no está en línea. Sin fecha, o en línea, no se inventa. */
export function lastSeenLabel(iso: string | null | undefined, now: number, online: boolean | null | undefined): string | null {
  if (online === true || !iso) return null;
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return null;
  const minutes = Math.floor(Math.max(0, now - time) / 60_000);
  if (minutes < 1) return "Visto hace un momento";
  if (minutes < 60) return minutes === 1 ? "Visto hace 1 min" : `Visto hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? "Visto hace 1 h" : `Visto hace ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return days === 1 ? "Visto hace 1 d" : `Visto hace ${days} d`;
  const months = Math.floor(days / 30);
  return months === 1 ? "Visto hace 1 mes" : `Visto hace ${months} meses`;
}
