import { addMadridDays, madridInstant, madridParts } from "./staff-shifts.ts";

/**
 * El Dashboard no va en tiempo real: se actualiza en cortes fijos en Europe/Madrid
 * (por defecto 00:00, 08:00 y 16:00). Las lecturas de OnlyFans del dashboard solo salen
 * en esos cortes y las cifras de cada día se cierran con el día vencido.
 */
export const DEFAULT_CUT_HOURS: readonly number[] = [0, 8, 16];

/** `FANLINK_DASHBOARD_CUTS`: horas separadas por coma («0,8,16»). «off» vuelve al intervalo de antes. */
export function cutHoursFromEnv(raw: string | undefined): number[] | null {
  if (raw == null || raw.trim() === "") return [...DEFAULT_CUT_HOURS];
  if (/^(off|false|no|0ff)$/i.test(raw.trim())) return null;
  const hours = [...new Set(raw.split(/[,;\s]+/).map((item) => Number(item)).filter((hour) => Number.isInteger(hour) && hour >= 0 && hour <= 23))].sort((a, b) => a - b);
  return hours.length > 0 ? hours : [...DEFAULT_CUT_HOURS];
}

/** Último corte que ya ha pasado (o es ahora). */
export function lastCut(now: Date, hours: readonly number[] = DEFAULT_CUT_HOURS): Date {
  const list = hours.length > 0 ? [...hours].sort((a, b) => a - b) : [...DEFAULT_CUT_HOURS];
  const today = madridParts(now);
  for (let back = 0; back <= 1; back += 1) {
    const day = addMadridDays(today, -back);
    for (let index = list.length - 1; index >= 0; index -= 1) {
      const at = madridInstant(day.year, day.month, day.day, (list[index] ?? 0) * 60);
      if (at.getTime() <= now.getTime()) return at;
    }
  }
  const yesterday = addMadridDays(today, -1);
  return madridInstant(yesterday.year, yesterday.month, yesterday.day, (list[0] ?? 0) * 60);
}

/** Próximo corte después de `now`. */
export function nextCut(now: Date, hours: readonly number[] = DEFAULT_CUT_HOURS): Date {
  const list = hours.length > 0 ? [...hours].sort((a, b) => a - b) : [...DEFAULT_CUT_HOURS];
  const today = madridParts(now);
  for (let ahead = 0; ahead <= 1; ahead += 1) {
    const day = addMadridDays(today, ahead);
    for (const hour of list) {
      const at = madridInstant(day.year, day.month, day.day, hour * 60);
      if (at.getTime() > now.getTime()) return at;
    }
  }
  const tomorrow = addMadridDays(today, 1);
  return madridInstant(tomorrow.year, tomorrow.month, tomorrow.day, (list[0] ?? 0) * 60);
}

/** Una cuenta toca en este corte si su última lectura es anterior al corte. */
export function dueForCut(lastAttemptAt: string | null | undefined, now: Date, hours: readonly number[] = DEFAULT_CUT_HOURS): boolean {
  if (!lastAttemptAt) return true;
  const last = Date.parse(lastAttemptAt);
  if (!Number.isFinite(last)) return true;
  return last < lastCut(now, hours).getTime();
}

/** Espera hasta el próximo corte. */
export function msUntilNextCut(now: Date, hours: readonly number[] = DEFAULT_CUT_HOURS): number {
  return Math.max(1_000, nextCut(now, hours).getTime() - now.getTime());
}

/** «hoy 16:00», «ayer 00:00» o «27/11 08:00», en Europe/Madrid. */
export function cutLabel(at: Date | string, now: Date = new Date()): string {
  const date = typeof at === "string" ? new Date(at) : at;
  if (!Number.isFinite(date.getTime())) return "Sin datos";
  const shown = madridParts(date);
  const today = madridParts(now);
  const yesterday = addMadridDays(today, -1);
  const hhmm = `${String(shown.hour).padStart(2, "0")}:${String(shown.minute).padStart(2, "0")}`;
  if (shown.year === today.year && shown.month === today.month && shown.day === today.day) return `hoy ${hhmm}`;
  if (shown.year === yesterday.year && shown.month === yesterday.month && shown.day === yesterday.day) return `ayer ${hhmm}`;
  return `${String(shown.day).padStart(2, "0")}/${String(shown.month).padStart(2, "0")} ${hhmm}`;
}

/** Minutos de las lecturas de fans online: 0 = solo en los cortes. Configurable mientras FANLINK lo decide. */
export function onlineSnapshotMinFromEnv(raw: string | undefined): number {
  if (raw == null || raw.trim() === "") return 0;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.max(15, Math.round(value));
}

/** Alertas: «live» se calculan al abrir el dashboard (estado de sesión al momento); «cuts» solo con lo del corte. */
export function alertsModeFromEnv(raw: string | undefined): "live" | "cuts" {
  return raw?.trim().toLowerCase() === "cuts" ? "cuts" : "live";
}
