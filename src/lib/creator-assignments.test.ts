import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { WorkspaceAccessError, type TeamAccess } from "./access-policy.ts";
import {
  assignmentsFromGrants,
  listAssignableStaff,
  listCreatorAssignments,
  setCreatorAssignees,
  staffNamesFor,
} from "./creator-assignments.ts";
import { todaySalesCents, formatSyncAge, connectivityOf, moneyUsd } from "./creator-board.ts";
import { editEmployee } from "./staff-invite.ts";
import { ensureStaff } from "./workspace-store.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

async function database() {
  const dir = await mkdtemp(path.join(tmpdir(), "fanlink-creators-"));
  const pg = new PGlite(dir);
  const files = (await readdir(path.join(root, "migrations"))).filter((name) => name.endsWith(".sql")).sort();
  for (const name of files) await pg.exec(await readFile(path.join(root, "migrations", name), "utf8"));
  const sql = { query: async <T>(text: string, params: unknown[] = []) => (await pg.query<T>(text, params)).rows };
  return { pg, sql };
}

const OWNER: TeamAccess = { userId: "duena", role: "owner", perms: [], creatorIds: [] };
const EQUIPO: TeamAccess = { userId: "manager", role: "member", perms: ["equipo"], creatorIds: [] };
const CHATTER: TeamAccess = { userId: "chatter", role: "member", perms: ["mensajes"], creatorIds: ["c-francia"] };

async function seedPeople(sql: Awaited<ReturnType<typeof database>>["sql"]) {
  await ensureStaff(sql, "duena", false);
  for (const person of [
    ["u-jose", "Jose"],
    ["u-allison", "Allison Miller"],
    ["u-rabbit", "Baby Rabbit"],
  ] as const) {
    await sql.query(
      `insert into staff_profile (user_id, display_name, role, perms, level, status)
       values ($1, $2, 'member', '[]'::jsonb, 'chatter', 'active')`,
      [...person],
    );
  }
  await sql.query(
    `insert into creator_grant (user_id, creator_id) values
      ('u-jose', 'c-francia'),
      ('u-allison', 'c-francia'),
      ('u-rabbit', 'c-francia')`,
  );
}

test("assignmentsFromGrants agrupa nombres y omite desactivados", () => {
  const rows = assignmentsFromGrants(
    [
      { user_id: "u-jose", creator_id: "c-francia" },
      { user_id: "u-allison", creator_id: "c-francia" },
      { user_id: "u-old", creator_id: "c-francia" },
    ],
    [
      { user_id: "u-jose", display_name: "Jose" },
      { user_id: "u-allison", display_name: "Allison Miller" },
      { user_id: "u-old", display_name: "Antiguo", status: "disabled" },
    ],
  );
  assert.deepEqual(staffNamesFor(rows, "c-francia"), ["Allison Miller", "Jose"]);
  assert.deepEqual(staffNamesFor(rows, "c-otra"), []);
});

test("listCreatorAssignments lee creator_grant, no el campo staff del CRM", async () => {
  const { pg, sql } = await database();
  try {
    await seedPeople(sql);
    const rows = await listCreatorAssignments(sql, OWNER);
    assert.deepEqual(staffNamesFor(rows, "c-francia"), ["Allison Miller", "Baby Rabbit", "Jose"]);
  } finally {
    await pg.close();
  }
});

test("setCreatorAssignees escribe grants y el empleado sigue viendo esa creadora", async () => {
  const { pg, sql } = await database();
  try {
    await seedPeople(sql);
    const afterDrop = await setCreatorAssignees(sql, EQUIPO, "c-francia", ["u-jose", "u-allison"]);
    assert.deepEqual(staffNamesFor(afterDrop, "c-francia"), ["Allison Miller", "Jose"]);

    const afterAdd = await setCreatorAssignees(sql, EQUIPO, "c-nora", ["u-rabbit"]);
    assert.deepEqual(staffNamesFor(afterAdd, "c-nora"), ["Baby Rabbit"]);
    assert.deepEqual(staffNamesFor(afterAdd, "c-francia"), ["Allison Miller", "Jose"]);

    const staff = await listAssignableStaff(sql, EQUIPO);
    assert.deepEqual(staff.map((item) => item.name), ["Allison Miller", "Baby Rabbit", "Jose"]);

    await editEmployee(sql, OWNER, "u-jose", "member", {
      name: "Jose",
      level: "chatter",
      creatorIds: ["c-francia", "c-alba"],
    });
    const afterEmployee = await listCreatorAssignments(sql, OWNER);
    assert.deepEqual(staffNamesFor(afterEmployee, "c-francia"), ["Allison Miller", "Jose"]);
    assert.deepEqual(staffNamesFor(afterEmployee, "c-alba"), ["Jose"]);
    assert.equal(staffNamesFor(afterEmployee, "c-nora").includes("Jose"), false);
  } finally {
    await pg.close();
  }
});

test("sin permiso equipo no se leen ni se escriben asignaciones", async () => {
  const { pg, sql } = await database();
  try {
    await seedPeople(sql);
    await assert.rejects(() => listCreatorAssignments(sql, CHATTER), WorkspaceAccessError);
    await assert.rejects(() => setCreatorAssignees(sql, CHATTER, "c-francia", ["u-jose"]), WorkspaceAccessError);
  } finally {
    await pg.close();
  }
});

test("ventas de hoy: dato real o null, nunca se inventa", () => {
  const noon = new Date("2026-11-28T12:00:00+01:00");
  assert.equal(todaySalesCents(undefined, noon), null);
  assert.equal(todaySalesCents({ earningsSyncedAt: null, earnings: [], transactions: [] }, noon), null);
  assert.equal(
    todaySalesCents(
      {
        earningsSyncedAt: "2026-11-28T11:00:00.000Z",
        earnings: [{ day: "2026-11-28", kind: "total", amountCents: 1250 }],
        transactions: null,
      },
      noon,
    ),
    1250,
  );
  assert.equal(
    todaySalesCents(
      {
        earningsSyncedAt: "2026-11-28T11:00:00.000Z",
        earnings: [{ day: "2026-11-28", kind: "total", amountCents: 9999 }],
        transactions: [
          { occurredAt: "2026-11-28T10:00:00+01:00", grossCents: 400 },
          { occurredAt: "2026-11-27T23:00:00+01:00", grossCents: 800 },
        ],
      },
      noon,
    ),
    400,
  );
  assert.equal(
    todaySalesCents({ earningsSyncedAt: "2026-11-28T11:00:00.000Z", earnings: [], transactions: [] }, noon),
    0,
  );
  assert.equal(moneyUsd(400), "$4.00");
});

test("edad de sync y estado de conectividad", () => {
  const now = Date.parse("2026-11-28T16:00:00.000Z");
  assert.equal(formatSyncAge(null, now), "Nunca");
  assert.equal(formatSyncAge("2026-11-28T15:50:00.000Z", now), "hace 10 min");
  assert.deepEqual(connectivityOf({ status: "active" }), { kind: "connected", label: "Conectado" });
  assert.deepEqual(connectivityOf({ status: "active", signedReadsBlocked: true }), { kind: "expired", label: "Sesión caducada" });
  assert.deepEqual(connectivityOf({ status: "expired" }), { kind: "expired", label: "Sesión caducada" });
  assert.deepEqual(connectivityOf(undefined), { kind: "offline", label: "Sin sesión" });
});

test("ventas de hoy: una lectura de ayer no sabe nada de hoy, y sin fila total se suman los tipos", () => {
  const noon = new Date("2026-11-28T12:00:00+01:00");
  assert.equal(
    todaySalesCents({ earningsSyncedAt: "2026-11-27T21:00:00.000Z", earnings: [], transactions: [] }, noon),
    null,
  );
  assert.equal(
    todaySalesCents(
      {
        earningsSyncedAt: "2026-11-28T11:00:00.000Z",
        earnings: [
          { day: "2026-11-28", kind: "subscription", amountCents: 600 },
          { day: "2026-11-28", kind: "tip", amountCents: 400 },
        ],
        transactions: null,
      },
      noon,
    ),
    1000,
  );
});
