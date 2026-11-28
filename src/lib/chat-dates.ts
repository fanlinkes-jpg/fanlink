const ZONE = "Europe/Madrid";
const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** Año, mes y día en hora de Madrid. Null si la fecha no es válida. */
export function madridDay(iso: string | null | undefined): { year: number; month: number; day: number } | null {
  if (!iso) return null;
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return null;
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: ZONE, year: "numeric", month: "numeric", day: "numeric" }).formatToParts(new Date(time));
  const pick = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return { year: pick("year"), month: pick("month"), day: pick("day") };
}

export function dayKey(iso: string | null | undefined): string | null {
  const day = madridDay(iso);
  return day ? `${day.year}-${day.month}-${day.day}` : null;
}

/** «Hoy», «Ayer», «20 nov», o «20 nov 2025» si es de otro año. */
export function dateSeparatorLabel(iso: string, nowMs: number): string | null {
  const day = madridDay(iso);
  const today = madridDay(new Date(nowMs).toISOString());
  if (!day || !today) return null;
  if (dayKey(iso) === dayKey(new Date(nowMs).toISOString())) return "Hoy";
  if (dayKey(iso) === dayKey(new Date(nowMs - 24 * 3600 * 1000).toISOString())) return "Ayer";
  const text = `${day.day} ${MONTHS[day.month - 1]}`;
  return day.year === today.year ? text : `${text} ${day.year}`;
}

/** Cada mensaje con el separador que lo precede: el primero del día lo lleva. */
export function withDateSeparators<T extends { sentAt?: string | null }>(messages: readonly T[], nowMs: number): Array<{ message: T; separator: string | null }> {
  let last: string | null = null;
  return messages.map((message) => {
    const key = dayKey(message.sentAt);
    if (!key) return { message, separator: null };
    const separator = key !== last ? dateSeparatorLabel(message.sentAt as string, nowMs) : null;
    last = key;
    return { message, separator };
  });
}
