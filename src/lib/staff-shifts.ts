/** Horarios de Turnos en zona Europe/Madrid. Lógica pura: guardar, leer, nocturno y retraso. */

export const SHIFT_ZONE = "Europe/Madrid";
export const LATE_GRACE_MS = 10 * 60 * 1000;
export const ONLINE_WINDOW_MS = 5 * 60 * 1000;
export const WEEKDAYS = [0, 1, 2, 3, 4] as const;
export const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6] as const;
export const DAY_LABELS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"] as const;
export const DAY_NAMES = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"] as const;

export type ShiftSlot = {
  weekday: number;
  off: boolean;
  startMinutes: number | null;
  endMinutes: number | null;
};

export type ShiftStatus = "none" | "on" | "late" | "absent";

export const STATUS_LABEL: Record<Exclude<ShiftStatus, "none">, string> = {
  on: "En turno",
  late: "Retraso",
  absent: "Ausente",
};

export type ShiftWindow = {
  weekday: number;
  start: Date;
  end: Date;
  shiftDate: string;
};

export type MadridParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
};

const WEEKDAY_FROM_SHORT: Record<string, number> = {
  mon: 0,
  tue: 1,
  wed: 2,
  thu: 3,
  fri: 4,
  sat: 5,
  sun: 6,
};

export function emptyWeek(): ShiftSlot[] {
  return ALL_DAYS.map((weekday) => ({ weekday, off: true, startMinutes: null, endMinutes: null }));
}

export function formatMinutes(minutes: number): string {
  const hour = Math.floor(((minutes % 1440) + 1440) % 1440 / 60);
  const min = ((minutes % 1440) + 1440) % 1440 % 60;
  return `${String(hour).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

export function parseTime(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

export function formatShift(slot: ShiftSlot): string {
  if (slot.off || slot.startMinutes == null || slot.endMinutes == null) return "Libre";
  return `${formatMinutes(slot.startMinutes)} – ${formatMinutes(slot.endMinutes)}`;
}

export function isOvernight(slot: ShiftSlot): boolean {
  if (slot.off || slot.startMinutes == null || slot.endMinutes == null) return false;
  return slot.endMinutes <= slot.startMinutes;
}

/** Duración en minutos. Si entrada y salida coinciden, es un turno de 24 h. */
export function durationMinutes(slot: ShiftSlot): number {
  if (slot.off || slot.startMinutes == null || slot.endMinutes == null) return 0;
  if (slot.endMinutes === slot.startMinutes) return 24 * 60;
  return (slot.endMinutes - slot.startMinutes + 1440) % 1440;
}

export function weeklyHours(slots: readonly ShiftSlot[]): number {
  return slots.reduce((sum, slot) => sum + durationMinutes(slot), 0) / 60;
}

export function copySlot(slot: ShiftSlot, weekday: number): ShiftSlot {
  return { weekday, off: slot.off, startMinutes: slot.startMinutes, endMinutes: slot.endMinutes };
}

export function applyCopy(week: readonly ShiftSlot[], slot: ShiftSlot, copy: "none" | "weekdays" | "week"): ShiftSlot[] {
  const days: number[] = copy === "week" ? [...ALL_DAYS] : copy === "weekdays" ? [...WEEKDAYS] : [slot.weekday];
  return emptyWeek().map((blank) => {
    const current = week[blank.weekday] ?? blank;
    return days.includes(blank.weekday) ? copySlot(slot, blank.weekday) : current;
  });
}

export function madridParts(at: Date): MadridParts {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: SHIFT_ZONE,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const weekday = WEEKDAY_FROM_SHORT[pick("weekday").slice(0, 3).toLowerCase()];
  return {
    year: Number(pick("year")),
    month: Number(pick("month")),
    day: Number(pick("day")),
    hour: Number(pick("hour")),
    minute: Number(pick("minute")),
    weekday: weekday ?? 0,
  };
}

export function madridDateKey(parts: Pick<MadridParts, "year" | "month" | "day">): string {
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function addMadridDays(parts: Pick<MadridParts, "year" | "month" | "day">, days: number): Pick<MadridParts, "year" | "month" | "day"> {
  const utc = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return { year: utc.getUTCFullYear(), month: utc.getUTCMonth() + 1, day: utc.getUTCDate() };
}

/**
 * Instante UTC que corresponde a esa fecha y minuto civil en Europe/Madrid,
 * también con el cambio de hora.
 */
export function madridInstant(year: number, month: number, day: number, minutes: number): Date {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const stamp = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`;
  let guess = Date.parse(`${stamp}Z`);
  for (let step = 0; step < 4; step += 1) {
    const shown = madridParts(new Date(guess));
    const shownMinutes = shown.hour * 60 + shown.minute;
    const shownDay = Date.UTC(shown.year, shown.month - 1, shown.day);
    const targetDay = Date.UTC(year, month - 1, day);
    const diff = shownDay - targetDay + (shownMinutes - minutes) * 60_000;
    guess -= diff;
    if (diff === 0) break;
  }
  return new Date(guess);
}

export function windowStartingOn(slot: ShiftSlot, startDay: Pick<MadridParts, "year" | "month" | "day">): ShiftWindow | null {
  if (slot.off || slot.startMinutes == null || slot.endMinutes == null) return null;
  const start = madridInstant(startDay.year, startDay.month, startDay.day, slot.startMinutes);
  const endDay = slot.endMinutes <= slot.startMinutes ? addMadridDays(startDay, 1) : startDay;
  const end = slot.endMinutes === slot.startMinutes
    ? new Date(start.getTime() + 24 * 60 * 60 * 1000)
    : madridInstant(endDay.year, endDay.month, endDay.day, slot.endMinutes);
  return { weekday: slot.weekday, start, end, shiftDate: madridDateKey(startDay) };
}

/** El día de esa columna más cercano que ya ha empezado o es hoy (en Madrid). */
export function startDayForWeekday(weekday: number, now: Date): Pick<MadridParts, "year" | "month" | "day"> {
  const today = madridParts(now);
  const back = (today.weekday - weekday + 7) % 7;
  return addMadridDays(today, -back);
}

export function cellStatus(slot: ShiftSlot, lastSeenAt: Date | string | null, now: Date): ShiftStatus {
  if (slot.off) return "none";
  const today = madridParts(now);
  const back = (today.weekday - slot.weekday + 7) % 7;
  if (back > 1) return "none";
  const win = windowStartingOn(slot, startDayForWeekday(slot.weekday, now));
  if (!win) return "none";
  if (now.getTime() < win.start.getTime()) return "none";
  const seen = seenTime(lastSeenAt);
  const showedUp = seen != null && seen.getTime() >= win.start.getTime();
  const connectedNow = showedUp && now.getTime() - (seen as Date).getTime() <= ONLINE_WINDOW_MS;
  if (now.getTime() < win.end.getTime()) {
    if (connectedNow) return "on";
    if (now.getTime() >= win.start.getTime() + LATE_GRACE_MS && !showedUp) return "late";
    return "none";
  }
  return showedUp ? "none" : "absent";
}

export function isLate(slot: ShiftSlot, lastSeenAt: Date | string | null, now: Date): boolean {
  return cellStatus(slot, lastSeenAt, now) === "late";
}

export function lateWindow(slots: readonly ShiftSlot[], lastSeenAt: Date | string | null, now: Date): ShiftWindow | null {
  const today = madridParts(now);
  for (const back of [0, 1]) {
    const day = addMadridDays(today, -back);
    const weekday = (today.weekday - back + 7) % 7;
    const slot = slots.find((item) => item.weekday === weekday);
    if (!slot) continue;
    const win = windowStartingOn(slot, day);
    if (!win) continue;
    if (now.getTime() < win.start.getTime() + LATE_GRACE_MS) continue;
    if (now.getTime() >= win.end.getTime()) continue;
    const seen = seenTime(lastSeenAt);
    if (seen && seen.getTime() >= win.start.getTime()) continue;
    return win;
  }
  return null;
}

export function readSlot(row: { weekday: number; is_off?: boolean | string; start_minutes?: number | string | null; end_minutes?: number | string | null }): ShiftSlot {
  const off = row.is_off === true || row.is_off === "t" || row.is_off === "true";
  const start = row.start_minutes == null ? null : Number(row.start_minutes);
  const end = row.end_minutes == null ? null : Number(row.end_minutes);
  if (off || start == null || end == null || !Number.isFinite(start) || !Number.isFinite(end)) {
    return { weekday: Number(row.weekday), off: true, startMinutes: null, endMinutes: null };
  }
  return { weekday: Number(row.weekday), off: false, startMinutes: start, endMinutes: end };
}

function seenTime(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}
