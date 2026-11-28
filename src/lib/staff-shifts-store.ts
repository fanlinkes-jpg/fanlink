import { randomUUID } from "node:crypto";
import { hasPerm, WorkspaceAccessError, type TeamAccess } from "./access-policy.ts";
import { readRoles, readStaffLevel, type StaffLevel } from "./staff-levels.ts";
import {
  ALL_DAYS,
  WEEKDAYS,
  applyCopy,
  cellStatus,
  emptyWeek,
  formatShift,
  lateWindow,
  parseTime,
  readSlot,
  weeklyHours,
  madridParts,
  type ShiftSlot,
  type ShiftStatus,
  STATUS_LABEL,
} from "./staff-shifts.ts";
import type { SqlQuery } from "./workspace-store.ts";
import { createWhatsAppSender, normalizePhone, type WhatsAppEnv } from "../../server/of-sessions/notify/whatsapp.ts";

export type ShiftCopy = "none" | "weekdays" | "week";

export type ShiftPersonView = {
  id: string;
  name: string;
  roleLabel: string;
  lastSeenAt: string | null;
  days: Array<{
    weekday: number;
    off: boolean;
    startMinutes: number | null;
    endMinutes: number | null;
    label: string;
    status: ShiftStatus;
    statusLabel: string | null;
  }>;
  weeklyHours: number;
};

export type ShiftNoticeView = {
  id: string;
  aboutUserId: string;
  body: string;
  createdAt: string;
  readAt: string | null;
};

export type ShiftBoardView = {
  canEdit: boolean;
  people: ShiftPersonView[];
  notices: ShiftNoticeView[];
  today: number;
};

const LEVEL_TEXT: Record<StaffLevel, string> = {
  owner: "Dueña",
  admin: "Admin",
  supervisor: "Supervisor",
  team_manager: "Team Manager",
  account_manager: "Account Manager",
  analyst: "Analyst",
  chatter: "Chatter",
};

function actorRolesOf(access: TeamAccess & { roles?: StaffLevel[] }): StaffLevel[] {
  if (Array.isArray(access.roles) && access.roles.length > 0) return access.roles;
  return access.role === "owner" ? ["owner"] : ["chatter"];
}

export function canEditShifts(access: TeamAccess | null): boolean {
  return hasPerm(access, "equipo");
}

export function isShiftAlertRecipient(role: string, roles: readonly StaffLevel[]): boolean {
  if (role === "owner" || roles.includes("owner")) return true;
  return roles.includes("admin") || roles.includes("supervisor");
}

export function cleanSlot(input: { weekday: number; off: boolean; start?: string | null; end?: string | null; startMinutes?: number | null; endMinutes?: number | null }): ShiftSlot {
  const weekday = Number(input.weekday);
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
    throw new WorkspaceAccessError("Elige un día de la semana.");
  }
  if (input.off) return { weekday, off: true, startMinutes: null, endMinutes: null };
  const start = input.startMinutes != null ? Number(input.startMinutes) : input.start ? parseTime(input.start) : null;
  const end = input.endMinutes != null ? Number(input.endMinutes) : input.end ? parseTime(input.end) : null;
  if (start == null || end == null || start < 0 || start > 1439 || end < 0 || end > 1439) {
    throw new WorkspaceAccessError("Indica la hora de entrada y la de salida.");
  }
  return { weekday, off: false, startMinutes: start, endMinutes: end };
}

export async function readWeek(sql: SqlQuery, userId: string): Promise<ShiftSlot[]> {
  const rows = await sql.query<{ weekday: number; is_off: boolean | string; start_minutes: number | string | null; end_minutes: number | string | null }>(
    "select weekday, is_off, start_minutes, end_minutes from staff_shift where user_id = $1",
    [userId],
  );
  const week = emptyWeek();
  for (const row of rows) {
    const slot = readSlot(row);
    week[slot.weekday] = slot;
  }
  return week;
}

export async function saveShifts(
  sql: SqlQuery,
  actor: TeamAccess,
  input: { userId: string; weekday: number; off: boolean; start?: string | null; end?: string | null; copy?: ShiftCopy },
  now: Date = new Date(),
): Promise<ShiftSlot[]> {
  if (!canEditShifts(actor)) throw new WorkspaceAccessError("No tienes permiso para editar los horarios.");
  const slot = cleanSlot(input);
  const current = await readWeek(sql, input.userId);
  const member = await sql.query<{ user_id: string }>("select user_id from staff_profile where user_id = $1", [input.userId]);
  if (!member[0]) throw new WorkspaceAccessError("No encontramos a esa persona.");
  const copy = input.copy === "week" || input.copy === "weekdays" ? input.copy : "none";
  const week = applyCopy(current, slot, copy);
  const days = copy === "week" ? [...ALL_DAYS] : copy === "weekdays" ? [...WEEKDAYS] : [slot.weekday];
  const at = now.toISOString();
  for (const weekday of days) {
    const next = week[weekday] ?? slot;
    await sql.query(
      `insert into staff_shift (user_id, weekday, start_minutes, end_minutes, is_off, timezone, updated_at, updated_by)
       values ($1, $2, $3, $4, $5, 'Europe/Madrid', $6, $7)
       on conflict (user_id, weekday) do update set
         start_minutes = excluded.start_minutes,
         end_minutes = excluded.end_minutes,
         is_off = excluded.is_off,
         timezone = 'Europe/Madrid',
         updated_at = excluded.updated_at,
         updated_by = excluded.updated_by`,
      [input.userId, weekday, next.off ? null : next.startMinutes, next.off ? null : next.endMinutes, next.off, at, actor.userId],
    );
  }
  return readWeek(sql, input.userId);
}

type MemberRow = {
  user_id: string;
  display_name: string;
  role: string;
  level: string | null;
  roles: unknown;
  last_seen_at: Date | string | null;
  status: string | null;
};

export async function listShiftBoard(sql: SqlQuery, actor: TeamAccess, now: Date = new Date()): Promise<ShiftBoardView> {
  await scanLateShifts(sql, now).catch(() => undefined);
  const members = await sql.query<MemberRow>(
    `select user_id, display_name, role, level, roles, last_seen_at, status
       from staff_profile
      where coalesce(status, 'active') = 'active'
      order by case when role = 'owner' then 0 else 1 end, lower(display_name), user_id`,
  );
  const visible = canEditShifts(actor) ? members : members.filter((row) => row.user_id === actor.userId);
  const ids = visible.map((row) => row.user_id);
  const shiftRows = ids.length === 0
    ? []
    : await sql.query<{ user_id: string; weekday: number; is_off: boolean | string; start_minutes: number | string | null; end_minutes: number | string | null }>(
        `select user_id, weekday, is_off, start_minutes, end_minutes from staff_shift where user_id = any($1::text[])`,
        [ids],
      );
  const byUser = new Map<string, ShiftSlot[]>();
  for (const id of ids) byUser.set(id, emptyWeek());
  for (const row of shiftRows) {
    const week = byUser.get(row.user_id) ?? emptyWeek();
    week[Number(row.weekday)] = readSlot(row);
    byUser.set(row.user_id, week);
  }
  const today = madridParts(now).weekday;
  const people: ShiftPersonView[] = visible.map((row) => {
    const roles = readRoles(row.roles, readStaffLevel(row.level ?? (row.role === "owner" ? "owner" : "chatter")));
    const week = byUser.get(row.user_id) ?? emptyWeek();
    const lastSeen = row.last_seen_at instanceof Date ? row.last_seen_at.toISOString() : row.last_seen_at;
    return {
      id: row.user_id,
      name: row.display_name,
      roleLabel: roles.map((role) => LEVEL_TEXT[role]).join(", "),
      lastSeenAt: lastSeen,
      days: week.map((slot) => {
        const status = cellStatus(slot, lastSeen, now);
        return {
          weekday: slot.weekday,
          off: slot.off,
          startMinutes: slot.startMinutes,
          endMinutes: slot.endMinutes,
          label: formatShift(slot),
          status,
          statusLabel: status === "none" ? null : STATUS_LABEL[status],
        };
      }),
      weeklyHours: weeklyHours(week),
    };
  });
  const actorRoles = actorRolesOf(actor);
  const notices = isShiftAlertRecipient(actor.role, actorRoles) ? await listShiftNotices(sql, actor.userId) : [];
  return { canEdit: canEditShifts(actor), people, notices, today };
}

export async function listShiftNotices(sql: SqlQuery, recipientId: string): Promise<ShiftNoticeView[]> {
  const rows = await sql.query<{ id: string; about_user_id: string; body: string; created_at: Date | string; read_at: Date | string | null }>(
    `select id, about_user_id, body, created_at, read_at
       from staff_notice
      where recipient_id = $1 and kind = 'shift_late'
      order by created_at desc
      limit 20`,
    [recipientId],
  );
  return rows.map((row) => ({
    id: row.id,
    aboutUserId: row.about_user_id,
    body: row.body,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    readAt: row.read_at instanceof Date ? row.read_at.toISOString() : row.read_at,
  }));
}

export async function markShiftNoticesRead(sql: SqlQuery, recipientId: string, now: Date = new Date()): Promise<void> {
  await sql.query(
    "update staff_notice set read_at = $2 where recipient_id = $1 and read_at is null and kind = 'shift_late'",
    [recipientId, now.toISOString()],
  );
}

type LateCandidate = {
  user_id: string;
  display_name: string;
  last_seen_at: Date | string | null;
};

export async function scanLateShifts(sql: SqlQuery, now: Date = new Date(), env: WhatsAppEnv = process.env): Promise<number> {
  const members = await sql.query<LateCandidate>(
    `select user_id, display_name, last_seen_at from staff_profile where coalesce(status, 'active') = 'active'`,
  );
  let sent = 0;
  for (const member of members) {
    const week = await readWeek(sql, member.user_id);
    const win = lateWindow(week, member.last_seen_at, now);
    if (!win) continue;
    const already = await sql.query<{ user_id: string }>(
      "select user_id from staff_shift_late where user_id = $1 and shift_date = $2::date",
      [member.user_id, win.shiftDate],
    );
    if (already[0]) continue;
    const inserted = await sql.query<{ user_id: string }>(
      "insert into staff_shift_late (user_id, shift_date, sent_at) values ($1, $2::date, $3) on conflict do nothing returning user_id",
      [member.user_id, win.shiftDate, now.toISOString()],
    );
    if (!inserted[0]) continue;
    const startLabel = new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(win.start);
    const endLabel = new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(win.end);
    const body = `${member.display_name} no se ha conectado en los 10 minutos siguientes al inicio de su turno (${startLabel} – ${endLabel}).`;
    const recipients = await shiftAlertRecipients(sql, member.user_id);
    for (const recipient of recipients) {
      await sql.query(
        `insert into staff_notice (id, kind, recipient_id, about_user_id, body, created_at)
         values ($1, 'shift_late', $2, $3, $4, $5)`,
        [randomUUID(), recipient.userId, member.user_id, body, now.toISOString()],
      );
      if (recipient.phone && recipient.alertsEnabled) {
        const send = createWhatsAppSender(env);
        const result = await send({ to: recipient.phone, body: `FANLINK · Retraso: ${body}` });
        if (result.ok) {
          await sql.query(
            `insert into alert_delivery (id, user_id, creator_id, fan_key, sent_at, provider, simulated)
             values ($1, $2, $3, $4, $5, $6, $7)`,
            [
              `shift-late:${recipient.userId}:${member.user_id}:${win.shiftDate}`.slice(0, 160),
              recipient.userId,
              "shift",
              `late:${win.shiftDate}:${member.user_id}`,
              now.toISOString(),
              result.provider,
              result.simulated,
            ],
          );
        }
      }
    }
    sent += 1;
  }
  return sent;
}

async function shiftAlertRecipients(sql: SqlQuery, exceptUserId: string): Promise<Array<{ userId: string; phone: string | null; alertsEnabled: boolean }>> {
  const rows = await sql.query<{ user_id: string; role: string; roles: unknown; level: string | null; phone: string | null; alerts_enabled: boolean | string | null }>(
    `select p.user_id, p.role, p.roles, p.level, a.phone, a.alerts_enabled
       from staff_profile p
       left join staff_alert a on a.user_id = p.user_id
      where coalesce(p.status, 'active') = 'active'`,
  );
  return rows
    .filter((row) => row.user_id !== exceptUserId)
    .filter((row) => isShiftAlertRecipient(row.role, readRoles(row.roles, readStaffLevel(row.level ?? (row.role === "owner" ? "owner" : "chatter")))))
    .map((row) => ({
      userId: row.user_id,
      phone: row.phone ? normalizePhone(row.phone) : null,
      alertsEnabled: row.alerts_enabled === true || row.alerts_enabled === "t" || row.alerts_enabled === "true",
    }));
}

let lastLiveScan = 0;

/** Para la entrada al CRM: como mucho una pasada por minuto. */
export function scanLateShiftsSoon(sql: SqlQuery): void {
  const now = Date.now();
  if (now - lastLiveScan < 60_000) return;
  lastLiveScan = now;
  void scanLateShifts(sql).catch(() => undefined);
}
