import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import {
  TEAM_PERMS,
  canSeeAgencyEarnings,
  canSeeBank,
  canSeeStatements,
  scopeWorkspaceFor,
  seesAllCreators,
  emptyWorkspace,
  type TeamAccess,
  type WorkspaceSlice,
} from "./access-policy.ts";
import {
  activateInvitedStaff,
  claimInvite,
  claimPasswordReset,
  createInvite,
  createPasswordReset,
  editEmployee,
  inspectPasswordReset,
  isStaffDisabled,
  revokeSessionsBefore,
  listEmployees,
  setEmployeeRoles,
} from "./staff-invite.ts";
import { describePerms, effectivePerms, isPermLocked, presetPerms, restrictPerms, ROLE_PRESETS, PERM_GROUPS } from "./staff-roles.ts";
import { INVITABLE_LEVELS, lastSeenLabel } from "./staff-levels.ts";
import { ensureStaff, readAccess } from "./workspace-store.ts";
import { presentTeamMetrics } from "../../server/of-sessions/metrics/present-team.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

async function database() {
  const dir = await mkdtemp(path.join(tmpdir(), "fanlink-roles-"));
  const pg = new PGlite(dir);
  const files = (await readdir(path.join(root, "migrations"))).filter((name) => name.endsWith(".sql")).sort();
  for (const name of files) await pg.exec(await readFile(path.join(root, "migrations", name), "utf8"));
  const sql = { query: async <T>(text: string, params: unknown[] = []) => (await pg.query<T>(text, params)).rows };
  return { pg, sql };
}

const NOW = new Date("2026-11-28T10:00:00.000Z");

test("preset por rol: chatter solo mensajes; Admin todo; Supervisor ve todo incluido el dinero", () => {
  assert.deepEqual(presetPerms(["chatter"]), ["mensajes"]);
  assert.deepEqual(presetPerms(["admin"]), [...TEAM_PERMS]);
  const supervisor = presetPerms(["supervisor"]);
  for (const perm of ["todas", "estadisticas", "banco", "estados", "mensajes"] as const) assert.ok(supervisor.includes(perm), perm);
  assert.ok(!supervisor.includes("ajustes"));
  for (const role of INVITABLE_LEVELS) assert.ok(ROLE_PRESETS[role].length > 0, role);
  // Cada permiso sale en un solo grupo del pop-up y ninguno se queda fuera.
  const grouped = PERM_GROUPS.flatMap((group) => group.perms);
  assert.deepEqual([...grouped].sort(), [...TEAM_PERMS].sort());
  assert.deepEqual(PERM_GROUPS.map((group) => group.label), ["Workspace", "Team Mgmt", "Analytics", "Chat", "Account Settings", "Statements"]);
});

test("varios roles: los permisos se suman", () => {
  const both = presetPerms(["team_manager", "analyst"]);
  for (const perm of [...ROLE_PRESETS.team_manager, ...ROLE_PRESETS.analyst]) assert.ok(both.includes(perm), perm);
  assert.deepEqual(presetPerms(["chatter", "admin"]), [...TEAM_PERMS]);
  // Chatter más Analyst ya no es «solo chatter»: no se le quita nada de lo del Analyst.
  assert.ok(presetPerms(["chatter", "analyst"]).includes("estadisticas"));
});

test("overrides: lo marcado de más se guarda por empleado y el chatter nunca recibe dinero", async () => {
  const { pg, sql } = await database();
  try {
    const actor = await ensureStaff(sql, "duena", false);
    // Account Manager con «banco» marcado de más.
    const created = await createInvite(sql, actor, { name: "Ana", email: "ana@x.es", roles: ["account_manager"], creatorIds: [], perms: [...presetPerms(["account_manager"]), "banco"] }, NOW);
    const claimed = await claimInvite(sql, created.token, NOW);
    assert.ok(claimed.ok);
    if (!claimed.ok) return;
    await activateInvitedStaff(sql, claimed.invite, "u-ana");
    const ana = await readAccess(sql, "u-ana", false);
    assert.ok(ana.perms.includes("banco"));
    assert.ok(!ana.perms.includes("estados"));
    assert.deepEqual(ana.roles, ["account_manager"]);
    assert.equal(canSeeBank(ana), true);
    assert.equal(canSeeStatements(ana), false);

    // Otro empleado del mismo rol no hereda ese override.
    const other = await createInvite(sql, actor, { name: "Luis", email: "luis@x.es", roles: ["account_manager"], creatorIds: [] }, NOW);
    const claimedOther = await claimInvite(sql, other.token, NOW);
    assert.ok(claimedOther.ok);
    if (!claimedOther.ok) return;
    await activateInvitedStaff(sql, claimedOther.invite, "u-luis");
    assert.deepEqual((await readAccess(sql, "u-luis", false)).perms, presetPerms(["account_manager"]));

    // Un chatter pide dinero a mano: el servidor lo quita al guardar y al leer.
    const chatter = await createInvite(sql, actor, { name: "Pau", email: "pau@x.es", roles: ["chatter"], creatorIds: [], perms: ["mensajes", "banco", "estados", "estadisticas", "todas"] }, NOW);
    const claimedChatter = await claimInvite(sql, chatter.token, NOW);
    assert.ok(claimedChatter.ok);
    if (!claimedChatter.ok) return;
    assert.deepEqual(claimedChatter.invite.perms, ["mensajes"]);
    await activateInvitedStaff(sql, claimedChatter.invite, "u-pau");
    await sql.query("update staff_profile set perms = '[\"mensajes\",\"banco\",\"estadisticas\",\"todas\"]'::jsonb where user_id = 'u-pau'");
    const pau = await readAccess(sql, "u-pau", false);
    assert.deepEqual(pau.perms, ["mensajes"]);

    // Cambiar el rol en Editar guarda el preset nuevo; sin perms pedidos se usa el preset.
    await editEmployee(sql, actor, "u-pau", "member", { name: "Pau", roles: ["supervisor"], creatorIds: [] });
    assert.deepEqual((await readAccess(sql, "u-pau", false)).perms, presetPerms(["supervisor"]));
    const row = (await listEmployees(sql, NOW)).find((item) => item.id === "u-pau");
    assert.deepEqual([row?.level, row?.roles], ["supervisor", ["supervisor"]]);
  } finally {
    await pg.close();
  }
});

test("varios roles en un empleado: se guardan, se suman y se editan en grupo", async () => {
  const { pg, sql } = await database();
  try {
    const actor = await ensureStaff(sql, "duena", false);
    const created = await createInvite(sql, actor, { name: "Eva", email: "eva@x.es", roles: ["team_manager", "admin"], creatorIds: [] }, NOW);
    const claimed = await claimInvite(sql, created.token, NOW);
    assert.ok(claimed.ok);
    if (!claimed.ok) return;
    assert.deepEqual(claimed.invite.roles, ["team_manager", "admin"]);
    await activateInvitedStaff(sql, claimed.invite, "u-eva");
    const eva = await readAccess(sql, "u-eva", false);
    assert.deepEqual(eva.roles, ["team_manager", "admin"]);
    assert.equal(eva.level, "team_manager");
    assert.deepEqual(eva.perms, [...TEAM_PERMS]);
    const listed = (await listEmployees(sql, NOW)).find((item) => item.id === "u-eva");
    assert.deepEqual(listed?.roles, ["team_manager", "admin"]);

    await setEmployeeRoles(sql, actor, [{ id: "u-eva", kind: "member" }], ["chatter"]);
    const after = await readAccess(sql, "u-eva", false);
    assert.deepEqual([after.roles, after.perms], [["chatter"], ["mensajes"]]);
    await assert.rejects(setEmployeeRoles(sql, after as TeamAccess, [{ id: "u-eva", kind: "member" }], ["admin"]), /dueña/);
    await assert.rejects(setEmployeeRoles(sql, actor, [{ id: "u-eva", kind: "member" }], ["owner"]), /Owner/);
    await assert.rejects(setEmployeeRoles(sql, actor, [{ id: "u-eva", kind: "member" }], []), /al menos un rol/);
  } finally {
    await pg.close();
  }
});

function slice(): WorkspaceSlice {
  return {
    ...emptyWorkspace(),
    creators: [
      { id: "alba", revenue30: 900, split: 20 } as WorkspaceSlice["creators"][number],
      { id: "bea", revenue30: 700, split: 30 } as WorkspaceSlice["creators"][number],
    ],
    history: [{ at: "2026-11-01", total: 1600 }],
    campaigns: [{ id: "k1", earned: 500 }],
  };
}

test("el chatter no ve dinero ni totales de agencia; el admin sí, con todas las creadoras", async () => {
  const { pg, sql } = await database();
  try {
    const owner = await ensureStaff(sql, "duena", false);
    await sql.query("insert into workspace_state (id, state, version, updated_by) values (1, $1::jsonb, 1, 'duena') on conflict (id) do update set state = excluded.state", [JSON.stringify(slice())]);
    const make = async (id: string, roles: string[], creatorIds: string[]) => {
      const created = await createInvite(sql, owner, { name: id, email: `${id}@x.es`, roles, creatorIds }, NOW);
      const claimed = await claimInvite(sql, created.token, NOW);
      assert.ok(claimed.ok);
      if (claimed.ok) await activateInvitedStaff(sql, claimed.invite, id);
      return readAccess(sql, id, false);
    };
    const chatter = await make("chatter1", ["chatter"], ["alba"]);
    const admin = await make("admin1", ["admin"], []);
    const supervisor = await make("super1", ["supervisor"], []);

    assert.equal(canSeeAgencyEarnings(chatter), false);
    assert.equal(canSeeBank(chatter), false);
    assert.equal(canSeeStatements(chatter), false);
    assert.equal(seesAllCreators(chatter), false);
    assert.deepEqual(chatter.creatorIds, ["alba"]);

    for (const person of [admin, supervisor]) {
      assert.equal(canSeeAgencyEarnings(person), true);
      assert.equal(canSeeBank(person), true);
      assert.equal(canSeeStatements(person), true);
      assert.deepEqual(person.creatorIds, ["alba", "bea"]);
    }

    const forChatter = scopeWorkspaceFor(chatter, slice());
    assert.deepEqual(forChatter.creators.map((item) => item.id), ["alba"]);
    assert.equal((forChatter.creators[0] as unknown as { revenue30: unknown }).revenue30, null);
    assert.deepEqual(forChatter.history, []);
    assert.equal((forChatter.campaigns[0] as unknown as { earned: number }).earned, 0);

    const forAdmin = scopeWorkspaceFor(admin, slice());
    assert.deepEqual(forAdmin.creators.map((item) => item.id), ["alba", "bea"]);
    assert.equal((forAdmin.creators[0] as unknown as { revenue30: unknown }).revenue30, 900);
    assert.equal(forAdmin.history.length, 1);
    assert.equal((forAdmin.campaigns[0] as unknown as { earned: number }).earned, 500);

    // Cifras por chatter: el chatter solo ve las suyas y sin totales de nadie más; el admin ve las de todos.
    const messages = [
      { key: "m1", creatorId: "alba", threadKey: "7", fanKey: "7", at: "2026-11-03T14:00:00.000Z", fromFan: false, priceCents: 500, purchased: true, authorId: "chatter1" },
      { key: "m2", creatorId: "alba", threadKey: "8", fanKey: "8", at: "2026-11-03T14:00:00.000Z", fromFan: false, priceCents: 700, purchased: true, authorId: "admin1" },
    ];
    const sales = [
      { key: "ppv:alba:m1", creatorId: "alba", fanKey: "7", at: "2026-11-03T15:00:00.000Z", grossCents: 500, kind: "ppv" as const, messageKey: "m1" },
      { key: "ppv:alba:m2", creatorId: "alba", fanKey: "8", at: "2026-11-03T15:00:00.000Z", grossCents: 700, kind: "ppv" as const, messageKey: "m2" },
    ];
    const names = new Map([["chatter1", "Chatter"], ["admin1", "Admin"]]);
    const mine = presentTeamMetrics(chatter, messages, sales, names);
    assert.deepEqual(mine.map((row) => [row.userId, row.grossCents]), [["chatter1", 500]]);
    const all = presentTeamMetrics(admin, messages, sales, names);
    assert.deepEqual(all.map((row) => [row.userId, row.grossCents]).sort(), [["admin1", 700], ["chatter1", 500]]);
  } finally {
    await pg.close();
  }
});

test("restrictPerms: el servidor aplica las reglas aunque la interfaz mande otra cosa", () => {
  assert.deepEqual(restrictPerms(["chatter"], ["mensajes", "banco", "estados", "estadisticas", "todas", "inventado"]), ["mensajes"]);
  assert.deepEqual(effectivePerms(["chatter"], ["mensajes", "precios"]), ["mensajes", "precios"]);
  assert.deepEqual(effectivePerms(["analyst"], null), presetPerms(["analyst"]));
  assert.deepEqual(effectivePerms(["owner"], []), [...TEAM_PERMS]);
  // Chatter + Team Manager: ni el texto ni las casillas pueden dejar Banco, porque el servidor lo quita.
  const both = presetPerms(["chatter", "team_manager"]);
  assert.equal(both.includes("banco"), false);
  assert.deepEqual(restrictPerms(["chatter", "team_manager"], [...both, "banco", "estados", "estadisticas", "todas"]), both);
  assert.equal(isPermLocked(["chatter", "team_manager"], "banco"), true);
  assert.equal(isPermLocked(["chatter", "team_manager"], "equipo"), false);
  // Si otro rol sí concede el dinero, se suma.
  assert.equal(isPermLocked(["chatter", "admin"], "banco"), false);
  assert.ok(effectivePerms(["chatter", "analyst"], presetPerms(["chatter", "analyst"])).includes("estadisticas"));
  assert.equal(isPermLocked(["chatter", "analyst"], "estadisticas"), false);
  assert.equal(isPermLocked(["chatter", "analyst"], "banco"), true);
  assert.equal(isPermLocked(["account_manager"], "banco"), false);
  const summary = describePerms(effectivePerms(["chatter", "team_manager"], [...both, "banco"]));
  assert.ok(summary.cannot.includes("abrir el Banco"));
  assert.equal(summary.can.includes("abrir el Banco"), false);
});

test("restablecer contraseña: enlace de un solo uso que caduca, solo para la dueña", async () => {
  const { pg, sql } = await database();
  try {
    const owner = await ensureStaff(sql, "duena", false);
    await sql.query("insert into staff_profile (user_id, display_name, role, perms, level, email) values ('u1', 'Marta', 'member', '[]', 'chatter', 'm@x.es')");
    const member = { ...owner, role: "member" as const, userId: "u1" };
    await assert.rejects(createPasswordReset(sql, member, "u1", NOW), /dueña/);
    const reset = await createPasswordReset(sql, owner, "u1", NOW);
    assert.equal(reset.email, "m@x.es");
    const stored = await sql.query<{ token_hash: string }>("select token_hash from staff_reset");
    assert.ok(!JSON.stringify(stored).includes(reset.token));
    assert.equal((await inspectPasswordReset(sql, reset.token, NOW)).state, "ok");
    const first = await claimPasswordReset(sql, reset.token, NOW);
    assert.ok(first.ok && first.userId === "u1");
    const second = await claimPasswordReset(sql, reset.token, NOW);
    assert.deepEqual(second, { ok: false, state: "used" });

    const again = await createPasswordReset(sql, owner, "u1", NOW);
    const later = new Date(NOW.getTime() + 25 * 60 * 60 * 1000);
    assert.deepEqual(await claimPasswordReset(sql, again.token, later), { ok: false, state: "expired" });
    // Uno nuevo anula el anterior.
    const third = await createPasswordReset(sql, owner, "u1", NOW);
    const fourth = await createPasswordReset(sql, owner, "u1", NOW);
    assert.deepEqual(await claimPasswordReset(sql, third.token, NOW), { ok: false, state: "revoked" });
    assert.ok((await claimPasswordReset(sql, fourth.token, NOW)).ok);
    assert.deepEqual(await claimPasswordReset(sql, "no-existe", NOW), { ok: false, state: "invalid" });
    await assert.rejects(createPasswordReset(sql, owner, "duena", NOW), /dueña/);
  } finally {
    await pg.close();
  }
});

test("resumen legible de permisos: lo que podrá y lo que no", () => {
  const chatter = describePerms(presetPerms(["chatter"]));
  assert.deepEqual(chatter.can, ["escribir en los chats"]);
  for (const text of ["ver totales ni dinero de la agencia", "abrir el Banco", "ver los Estados de cuenta", "ver creadoras que no tenga asignadas"]) assert.ok(chatter.cannot.includes(text), text);
  const admin = describePerms(presetPerms(["admin"]));
  assert.deepEqual(admin.cannot, []);
  assert.ok(admin.can.includes("abrir el Banco") && admin.can.includes("ver las cifras y el dinero de la agencia"));
});

test("última conexión: se guarda al entrar (como mucho una vez por minuto) y se lee en la lista", async () => {
  const { pg, sql } = await database();
  try {
    const owner = await ensureStaff(sql, "duena", false);
    const first = (await listEmployees(sql, NOW)).find((row) => row.id === "duena")?.lastSeenAt;
    assert.ok(first, "entrar deja la hora");
    await sql.query("update staff_profile set last_seen_at = now() - interval '10 minutes' where user_id = 'duena'");
    await ensureStaff(sql, "duena", false);
    const refreshed = (await listEmployees(sql, NOW)).find((row) => row.id === "duena")?.lastSeenAt;
    assert.ok(refreshed && Date.now() - new Date(refreshed).getTime() < 60_000);
    // Dos entradas seguidas no reescriben.
    const stamp = refreshed;
    await ensureStaff(sql, "duena", false);
    assert.equal((await listEmployees(sql, NOW)).find((row) => row.id === "duena")?.lastSeenAt, stamp);
    await sql.query("insert into staff_profile (user_id, display_name, role, perms, level) values ('nuevo', 'Nuevo', 'member', '[]', 'chatter')");
    assert.equal((await listEmployees(sql, NOW)).find((row) => row.id === "nuevo")?.lastSeenAt, null);
    assert.equal(owner.role, "owner");
  } finally {
    await pg.close();
  }
});

test("lastSeenLabel: ahora, minutos, horas, días y nunca", () => {
  const now = new Date("2026-11-28T12:00:00.000Z");
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();
  assert.equal(lastSeenLabel(null, now), "Nunca");
  assert.equal(lastSeenLabel(ago(30_000), now), "Ahora");
  assert.equal(lastSeenLabel(ago(5 * 60_000), now), "hace 5 min");
  assert.equal(lastSeenLabel(ago(3 * 3_600_000), now), "hace 3 h");
  assert.equal(lastSeenLabel(ago(2 * 86_400_000), now), "hace 2 d");
  assert.match(lastSeenLabel(ago(90 * 86_400_000), now), /\d{2}\/\d{2}\/\d{4}/);
});

test("cambiar la contraseña invalida las sesiones anteriores aunque la cookie siga en caché", async () => {
  const { pg, sql } = await database();
  try {
    await sql.query("insert into staff_profile (user_id, display_name, role, perms, level) values ('u1', 'Marta', 'member', '[]', 'chatter')");
    const before = new Date("2026-11-28T09:00:00.000Z");
    const change = new Date("2026-11-28T10:00:00.000Z");
    const after = new Date("2026-11-28T10:05:00.000Z");
    assert.equal(await isStaffDisabled(sql, "u1", before), false);
    await revokeSessionsBefore(sql, "u1", change);
    assert.equal(await isStaffDisabled(sql, "u1", before), true);
    assert.equal(await isStaffDisabled(sql, "u1", after), false);
    assert.equal(await isStaffDisabled(sql, "u1"), false);
  } finally {
    await pg.close();
  }
});
