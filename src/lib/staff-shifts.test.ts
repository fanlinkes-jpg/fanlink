import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { WorkspaceAccessError } from "./access-policy.ts";
import { ensureStaff } from "./workspace-store.ts";
import {
  SHIFT_ZONE,
  applyCopy,
  cellStatus,
  durationMinutes,
  formatShift,
  isOvernight,
  lateWindow,
  madridInstant,
  madridParts,
  parseTime,
  weeklyHours,
  type ShiftSlot,
} from "./staff-shifts.ts";
import { canEditShifts, isShiftAlertRecipient, listShiftBoard, saveShifts, scanLateShifts } from "./staff-shifts-store.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

async function database() {
  const dir = await mkdtemp(path.join(tmpdir(), "fanlink-shifts-"));
  const pg = new PGlite(dir);
  const files = (await readdir(path.join(root, "migrations"))).filter((name) => name.endsWith(".sql")).sort();
  for (const name of files) await pg.exec(await readFile(path.join(root, "migrations", name), "utf8"));
  const sql = { query: async <T>(text: string, params: unknown[] = []) => (await pg.query<T>(text, params)).rows };
  return { pg, sql };
}

function slot(weekday: number, start: string, end: string): ShiftSlot {
  return { weekday, off: false, startMinutes: parseTime(start), endMinutes: parseTime(end) };
}

const off = (weekday: number): ShiftSlot => ({ weekday, off: true, startMinutes: null, endMinutes: null });

test("guardar y leer horarios, también copiando a laborables o a toda la semana", async () => {
  const { pg, sql } = await database();
  try {
    const owner = await ensureStaff(sql, "duena", false);
    await sql.query("insert into staff_profile (user_id, display_name, role, perms, level) values ('u-marta', 'Marta Ruiz', 'member', '[]', 'chatter')");
    const week = await saveShifts(sql, owner, { userId: "u-marta", weekday: 0, off: false, start: "08:00", end: "16:00", copy: "weekdays" });
    assert.equal(formatShift(week[0]!), "08:00 – 16:00");
    assert.equal(formatShift(week[4]!), "08:00 – 16:00");
    assert.equal(formatShift(week[5]!), "Libre");
    assert.equal(formatShift(week[6]!), "Libre");
    assert.equal(weeklyHours(week), 8 * 5);

    const full = await saveShifts(sql, owner, { userId: "u-marta", weekday: 5, off: false, start: "10:00", end: "14:00", copy: "week" });
    for (const day of full) assert.equal(formatShift(day), "10:00 – 14:00");
    const board = await listShiftBoard(sql, owner, madridInstant(2026, 11, 30, 12 * 60));
    const marta = board.people.find((person) => person.id === "u-marta");
    assert.ok(marta);
    assert.equal(marta.days[0]?.label, "10:00 – 14:00");
    assert.equal(board.canEdit, true);

    const rows = await sql.query<{ timezone: string }>("select timezone from staff_shift where user_id = 'u-marta' limit 1");
    assert.equal(rows[0]?.timezone, SHIFT_ZONE);
  } finally {
    await pg.close();
  }
});

test("turno nocturno: de 22:00 a 06:00 pasa de medianoche y dura 8 horas", () => {
  const night = slot(4, "22:00", "06:00");
  assert.equal(isOvernight(night), true);
  assert.equal(formatShift(night), "22:00 – 06:00");
  assert.equal(durationMinutes(night), 8 * 60);
  // Viernes 28 nov 2026 22:00 Madrid = 21:00 UTC. El sábado a las 00:30 sigue dentro.
  const start = madridInstant(2026, 11, 27, 22 * 60); // Friday
  assert.equal(madridParts(start).weekday, 4);
  assert.equal(madridParts(start).hour, 22);
  const lateNight = madridInstant(2026, 11, 28, 30); // Saturday 00:30
  assert.equal(cellStatus(night, null, lateNight), "late");
  const connected = new Date(start.getTime() + 2 * 60 * 1000);
  assert.equal(cellStatus(night, connected, new Date(connected.getTime() + 30_000)), "on");
  const after = madridInstant(2026, 11, 28, 7 * 60); // Saturday 07:00, shift ended at 06:00
  assert.equal(cellStatus(night, null, after), "absent");
});

test("aviso de retraso: a los 10 minutos sin conexión avisa a dueña, Admin y Supervisor, no al chatter", async () => {
  const { pg, sql } = await database();
  try {
    const owner = await ensureStaff(sql, "duena", false);
    await sql.query("update staff_profile set display_name = 'Dueña' where user_id = 'duena'");
    await sql.query("insert into staff_profile (user_id, display_name, role, perms, level, roles) values ('u-marta', 'Marta Ruiz', 'member', '[\"mensajes\"]', 'chatter', '[]')");
    await sql.query("insert into staff_profile (user_id, display_name, role, perms, level, roles) values ('u-admin', 'Ana Admin', 'member', '[]', 'admin', '[\"admin\"]')");
    await sql.query("insert into staff_profile (user_id, display_name, role, perms, level, roles) values ('u-super', 'Sara Super', 'member', '[]', 'supervisor', '[\"supervisor\"]')");
    await sql.query("insert into staff_profile (user_id, display_name, role, perms, level, roles) values ('u-tm', 'Toni TM', 'member', '[\"equipo\"]', 'team_manager', '[\"team_manager\"]')");
    await sql.query("insert into staff_alert (user_id, phone, alerts_enabled, quiet_minutes) values ('duena', '+34600111000', true, 15)");
    await sql.query("insert into staff_alert (user_id, phone, alerts_enabled, quiet_minutes) values ('u-admin', '+34600111001', true, 15)");
    await saveShifts(sql, owner, { userId: "u-marta", weekday: 0, off: false, start: "08:00", end: "16:00" });

    // Lunes 30 nov 2026, 08:05 Madrid: aún no.
    const early = madridInstant(2026, 11, 30, 8 * 60 + 5);
    assert.equal(madridParts(early).weekday, 0);
    assert.equal(await scanLateShifts(sql, early, {}), 0);

    // 08:15: retraso. El enviador simulado (sin credenciales) deja constancia en alert_delivery.
    const late = madridInstant(2026, 11, 30, 8 * 60 + 15);
    assert.equal(cellStatus(slot(0, "08:00", "16:00"), null, late), "late");
    assert.ok(lateWindow([slot(0, "08:00", "16:00"), off(1), off(2), off(3), off(4), off(5), off(6)], null, late));
    assert.equal(await scanLateShifts(sql, late, {}), 1);
    assert.equal(await scanLateShifts(sql, late, {}), 0, "no se repite el mismo día");

    const notices = await sql.query<{ recipient_id: string; body: string }>("select recipient_id, body from staff_notice where kind = 'shift_late' order by recipient_id");
    const recipients = notices.map((row) => row.recipient_id).sort();
    assert.deepEqual(recipients, ["duena", "u-admin", "u-super"]);
    assert.ok(notices[0]?.body.includes("Marta Ruiz"));
    assert.ok(notices[0]?.body.includes("08:00"));

    const phones = await sql.query<{ user_id: string; provider: string; simulated: boolean | string }>("select user_id, provider, simulated from alert_delivery where creator_id = 'shift'");
    assert.deepEqual(phones.map((row) => row.user_id).sort(), ["duena", "u-admin"]);
    assert.ok(phones.every((row) => row.provider === "simulated"));

    const ownerBoard = await listShiftBoard(sql, owner, late);
    assert.ok(ownerBoard.notices.some((item) => item.body.includes("Marta Ruiz")));
    assert.equal(ownerBoard.people.find((person) => person.id === "u-marta")?.days[0]?.status, "late");

    const admin = await ensureStaff(sql, "u-admin", false);
    const adminBoard = await listShiftBoard(sql, admin, late);
    assert.ok(adminBoard.notices.length > 0);

    const tm = await ensureStaff(sql, "u-tm", false);
    const tmBoard = await listShiftBoard(sql, tm, late);
    assert.equal(tmBoard.canEdit, true);
    assert.equal(tmBoard.notices.length, 0, "el Team Manager edita horarios pero no recibe el aviso de retraso");
  } finally {
    await pg.close();
  }
});

test("permisos: solo quien gestiona el equipo edita; el chatter solo ve su horario", async () => {
  const { pg, sql } = await database();
  try {
    const owner = await ensureStaff(sql, "duena", false);
    await sql.query("insert into staff_profile (user_id, display_name, role, perms, level, roles) values ('u-marta', 'Marta Ruiz', 'member', '[\"mensajes\"]', 'chatter', '[]')");
    await sql.query("insert into staff_profile (user_id, display_name, role, perms, level, roles) values ('u-otro', 'Otro', 'member', '[\"mensajes\"]', 'chatter', '[]')");
    await sql.query("insert into staff_profile (user_id, display_name, role, perms, level, roles) values ('u-tm', 'Toni', 'member', '[\"equipo\"]', 'team_manager', '[\"team_manager\"]')");
    await saveShifts(sql, owner, { userId: "u-marta", weekday: 0, off: false, start: "08:00", end: "16:00" });

    const chatter = await ensureStaff(sql, "u-marta", false);
    assert.equal(canEditShifts(chatter), false);
    await assert.rejects(saveShifts(sql, chatter, { userId: "u-marta", weekday: 1, off: false, start: "09:00", end: "17:00" }), WorkspaceAccessError);
    const own = await listShiftBoard(sql, chatter, madridInstant(2026, 11, 30, 12 * 60));
    assert.equal(own.canEdit, false);
    assert.deepEqual(own.people.map((person) => person.id), ["u-marta"]);
    assert.equal(own.people[0]?.days[0]?.label, "08:00 – 16:00");
    assert.equal(own.notices.length, 0);

    const tm = await ensureStaff(sql, "u-tm", false);
    assert.equal(canEditShifts(tm), true);
    const all = await listShiftBoard(sql, tm, madridInstant(2026, 11, 30, 12 * 60));
    assert.ok(all.people.some((person) => person.id === "u-marta"));
    assert.ok(all.people.some((person) => person.id === "u-otro"));
    await saveShifts(sql, tm, { userId: "u-otro", weekday: 2, off: false, start: "22:00", end: "06:00" });
    const again = await listShiftBoard(sql, tm, madridInstant(2026, 11, 30, 12 * 60));
    assert.equal(again.people.find((person) => person.id === "u-otro")?.days[2]?.label, "22:00 – 06:00");

    assert.equal(isShiftAlertRecipient("owner", ["owner"]), true);
    assert.equal(isShiftAlertRecipient("member", ["admin"]), true);
    assert.equal(isShiftAlertRecipient("member", ["supervisor"]), true);
    assert.equal(isShiftAlertRecipient("member", ["team_manager"]), false);
    assert.equal(isShiftAlertRecipient("member", ["chatter"]), false);

  } finally {
    await pg.close();
  }
});

test("copiar un Libre a la semana deja todos los días libres", () => {
  const week = applyCopy([slot(0, "08:00", "16:00"), slot(1, "08:00", "16:00"), off(2), off(3), off(4), off(5), off(6)], off(0), "week");
  assert.ok(week.every((item) => item.off && formatShift(item) === "Libre"));
});
