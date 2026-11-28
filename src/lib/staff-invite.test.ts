import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { WorkspaceAccessError, type TeamAccess } from "./access-policy.ts";
import {
  INVITE_TTL_MS,
  activateInvitedStaff,
  claimInvite,
  createInvite,
  deleteEmployee,
  editEmployee,
  hashToken,
  inspectInvite,
  isStaffDisabled,
  listEmployees,
  releaseInvite,
  renewInvite,
  setEmployeeActive,
} from "./staff-invite.ts";
import { inviteEmail, sendInviteMail } from "./staff-mail.ts";
import { ensureStaff, readAccess } from "./workspace-store.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

async function database() {
  const dir = await mkdtemp(path.join(tmpdir(), "fanlink-invite-"));
  const pg = new PGlite(dir);
  const files = (await readdir(path.join(root, "migrations"))).filter((name) => name.endsWith(".sql")).sort();
  for (const name of files) await pg.exec(await readFile(path.join(root, "migrations", name), "utf8"));
  const sql = { query: async <T>(text: string, params: unknown[] = []) => (await pg.query<T>(text, params)).rows };
  return { pg, sql };
}

const NOW = new Date("2026-11-28T10:00:00.000Z");
const INPUT = { name: "Marta Ruiz", email: "Marta@Example.com", level: "chatter", creatorIds: ["allison", "jose"] };

async function owner(sql: Awaited<ReturnType<typeof database>>["sql"]): Promise<TeamAccess> {
  return ensureStaff(sql, "duena", false);
}

test("token correcto: se acepta una vez y guarda solo el hash", async () => {
  const { pg, sql } = await database();
  try {
    const actor = await owner(sql);
    const created = await createInvite(sql, actor, INPUT, NOW);
    assert.equal(new Date(created.expiresAt).getTime() - NOW.getTime(), INVITE_TTL_MS);
    const stored = await sql.query<{ token_hash: string; email: string }>("select token_hash, email from staff_invite");
    assert.equal(stored[0]?.token_hash, hashToken(created.token));
    assert.notEqual(stored[0]?.token_hash, created.token);
    assert.equal(stored[0]?.email, "marta@example.com");
    assert.deepEqual(await inspectInvite(sql, created.token, NOW), { state: "ok", name: "Marta Ruiz", email: "marta@example.com" });

    const claimed = await claimInvite(sql, created.token, NOW);
    assert.equal(claimed.ok, true);
    if (!claimed.ok) return;
    assert.equal(claimed.invite.level, "chatter");
    assert.deepEqual(claimed.invite.creatorIds, ["allison", "jose"]);
  } finally {
    await pg.close();
  }
});

test("token caducado: pasados 7 días no se acepta ni se muestra", async () => {
  const { pg, sql } = await database();
  try {
    const actor = await owner(sql);
    const created = await createInvite(sql, actor, INPUT, NOW);
    const later = new Date(NOW.getTime() + INVITE_TTL_MS + 1000);
    assert.equal((await inspectInvite(sql, created.token, later)).state, "expired");
    const claimed = await claimInvite(sql, created.token, later);
    assert.deepEqual(claimed, { ok: false, state: "expired" });
    const justBefore = new Date(NOW.getTime() + INVITE_TTL_MS - 1000);
    assert.equal((await claimInvite(sql, created.token, justBefore)).ok, true);
  } finally {
    await pg.close();
  }
});

test("token reutilizado: la segunda vez falla, también si llegan a la vez", async () => {
  const { pg, sql } = await database();
  try {
    const actor = await owner(sql);
    const created = await createInvite(sql, actor, INPUT, NOW);
    const [a, b] = await Promise.all([claimInvite(sql, created.token, NOW), claimInvite(sql, created.token, NOW)]);
    assert.equal([a, b].filter((item) => item.ok).length, 1);
    assert.deepEqual(await claimInvite(sql, created.token, NOW), { ok: false, state: "used" });
    assert.deepEqual(await claimInvite(sql, "token-inventado", NOW), { ok: false, state: "invalid" });
    assert.deepEqual(await claimInvite(sql, "", NOW), { ok: false, state: "invalid" });
  } finally {
    await pg.close();
  }
});

test("si falla la creación de la cuenta, el token se libera y vuelve a valer", async () => {
  const { pg, sql } = await database();
  try {
    const actor = await owner(sql);
    const created = await createInvite(sql, actor, INPUT, NOW);
    const claimed = await claimInvite(sql, created.token, NOW);
    assert.equal(claimed.ok, true);
    if (!claimed.ok) return;
    await releaseInvite(sql, claimed.invite.id);
    assert.equal((await claimInvite(sql, created.token, NOW)).ok, true);
  } finally {
    await pg.close();
  }
});

test("reenviar anula el token anterior; una invitación nueva al mismo correo sustituye a la vieja", async () => {
  const { pg, sql } = await database();
  try {
    const actor = await owner(sql);
    const first = await createInvite(sql, actor, INPUT, NOW);
    const renewed = await renewInvite(sql, actor, first.id, new Date(NOW.getTime() + 1000));
    assert.equal((await inspectInvite(sql, first.token, NOW)).state, "invalid");
    assert.equal((await inspectInvite(sql, renewed.token, NOW)).state, "ok");
    const second = await createInvite(sql, actor, INPUT, NOW);
    assert.equal((await inspectInvite(sql, renewed.token, NOW)).state, "revoked");
    assert.equal((await inspectInvite(sql, second.token, NOW)).state, "ok");
    assert.equal((await listEmployees(sql, NOW)).filter((row) => row.kind === "invite").length, 1);
  } finally {
    await pg.close();
  }
});

test("solo la dueña invita; el rol Owner no se puede asignar; el correo tiene que ser válido", async () => {
  const { pg, sql } = await database();
  try {
    const actor = await owner(sql);
    const member: TeamAccess = { userId: "m", role: "member", perms: ["equipo"], creatorIds: [] };
    await assert.rejects(createInvite(sql, member, INPUT, NOW), WorkspaceAccessError);
    await assert.rejects(createInvite(sql, actor, { ...INPUT, level: "owner" }, NOW), /Owner/);
    await assert.rejects(createInvite(sql, actor, { ...INPUT, email: "sin-arroba" }, NOW), /correo/);
    await assert.rejects(createInvite(sql, actor, { ...INPUT, name: "  " }, NOW), /nombre/);
    await assert.rejects(createInvite(sql, actor, { ...INPUT, level: "dios" }, NOW), WorkspaceAccessError);
  } finally {
    await pg.close();
  }
});

test("aceptar activa la ficha con su nivel y sus creadoras; la lista las enseña", async () => {
  const { pg, sql } = await database();
  try {
    const actor = await owner(sql);
    const created = await createInvite(sql, actor, { ...INPUT, level: "supervisor" }, NOW);
    const claimed = await claimInvite(sql, created.token, NOW);
    assert.equal(claimed.ok, true);
    if (!claimed.ok) return;
    await sql.query(
      `insert into "user" ("id", "name", "email", "emailVerified") values ('u-marta', 'Marta Ruiz', 'marta@example.com', true)`,
    );
    await activateInvitedStaff(sql, claimed.invite, "u-marta");
    const access = await readAccess(sql, "u-marta", false);
    assert.deepEqual(
      { role: access.role, perms: access.perms, creatorIds: access.creatorIds, level: access.level, status: access.status },
      { role: "member", perms: ["mensajes"], creatorIds: ["allison", "jose"], level: "supervisor", status: "active" },
    );
    const rows = await listEmployees(sql, NOW);
    assert.deepEqual(rows.map((row) => [row.name, row.level, row.status]), [
      ["Miembro", "owner", "active"],
      ["Marta Ruiz", "supervisor", "active"],
    ]);
    await assert.rejects(createInvite(sql, actor, INPUT, NOW), /ya hay un empleado/i);
  } finally {
    await pg.close();
  }
});

test("desactivar corta sesiones y acceso; activar lo devuelve", async () => {
  const { pg, sql } = await database();
  try {
    const actor = await owner(sql);
    await sql.query(`insert into "user" ("id", "name", "email", "emailVerified") values ('u1', 'Marta', 'm@x.es', true)`);
    await sql.query(
      `insert into "session" ("id", "expiresAt", "token", "updatedAt", "userId") values ('s1', now() + interval '1 day', 't1', now(), 'u1')`,
    );
    await sql.query("insert into staff_profile (user_id, display_name, role, perms, level, email) values ('u1', 'Marta', 'member', '[\"mensajes\"]', 'chatter', 'm@x.es')");
    await sql.query("insert into creator_grant (user_id, creator_id) values ('u1', 'allison')");
    assert.deepEqual((await readAccess(sql, "u1", false)).creatorIds, ["allison"]);

    await setEmployeeActive(sql, actor, "u1", false);
    assert.equal(await isStaffDisabled(sql, "u1"), true);
    assert.equal((await sql.query(`select 1 from "session" where "userId" = 'u1'`)).length, 0);
    const off = await readAccess(sql, "u1", false);
    assert.deepEqual({ perms: off.perms, creatorIds: off.creatorIds, status: off.status }, { perms: [], creatorIds: [], status: "disabled" });
    assert.equal((await listEmployees(sql)).find((row) => row.id === "u1")?.status, "disabled");

    await setEmployeeActive(sql, actor, "u1", true);
    assert.deepEqual((await readAccess(sql, "u1", false)).creatorIds, ["allison"]);
    await assert.rejects(setEmployeeActive(sql, actor, "duena", false), /dueña/);
  } finally {
    await pg.close();
  }
});

test("editar cambia nombre, nivel y creadoras", async () => {
  const { pg, sql } = await database();
  try {
    const actor = await owner(sql);
    await sql.query("insert into staff_profile (user_id, display_name, role, perms, level) values ('u1', 'Marta', 'member', '[]', 'chatter')");
    await sql.query("insert into creator_grant (user_id, creator_id) values ('u1', 'allison'), ('u1', 'jose')");
    await editEmployee(sql, actor, "u1", "member", { name: "Marta R.", level: "analyst", creatorIds: ["jose", "luna"], perms: ["mensajes", "precios", "inventado"] });
    const row = (await listEmployees(sql)).find((item) => item.id === "u1");
    assert.deepEqual([row?.name, row?.level, row?.creatorIds, row?.perms], ["Marta R.", "analyst", ["jose", "luna"], ["mensajes", "precios"]]);
    await assert.rejects(editEmployee(sql, actor, "u1", "member", { name: "x", level: "owner", creatorIds: [], perms: [] }), /Owner/);
    await assert.rejects(editEmployee(sql, actor, "duena", "member", { name: "x", level: "chatter", creatorIds: [], perms: [] }), /dueña/);
  } finally {
    await pg.close();
  }
});

test("borrar a alguien conserva sus envíos: autor null y nombre guardado", async () => {
  const { pg, sql } = await database();
  try {
    const actor = await owner(sql);
    await sql.query("insert into staff_profile (user_id, display_name, role, perms, level) values ('u1', 'Marta', 'member', '[]', 'chatter')");
    await sql.query("insert into creator_grant (user_id, creator_id) values ('u1', 'allison')");
    await sql.query(`insert into "user" ("id", "name", "email", "emailVerified") values ('u1', 'Marta', 'm@x.es', true)`);
    await sql.query("insert into of_chat_outbound (id, creator_id, author_id, body) values ('o1', 'allison', 'u1', 'hola')");
    await sql.query("insert into of_chat_message (creator_id, message_key, thread_key, from_fan, body, sent_at, synced_at, author_id) values ('allison', 'm1', 't1', false, 'hola', now(), now(), 'u1')");
    const before = await sql.query<{ author_name: string | null }>("select author_name from of_chat_outbound where id = 'o1'");
    assert.equal(before[0]?.author_name, "Marta");
    // Un cambio posterior de nombre no reescribe lo ya enviado.
    await sql.query("update staff_profile set display_name = 'Marta R.' where user_id = 'u1'");
    await sql.query("update of_chat_message set author_id = 'u1' where message_key = 'm1'");

    await deleteEmployee(sql, actor, "u1", "member");
    const outbound = await sql.query<{ author_id: string | null; author_name: string | null; body: string }>(
      "select author_id, author_name, body from of_chat_outbound where id = 'o1'",
    );
    assert.deepEqual(outbound, [{ author_id: null, author_name: "Marta", body: "hola" }]);
    const message = await sql.query<{ author_id: string | null; author_name: string | null }>(
      "select author_id, author_name from of_chat_message where message_key = 'm1'",
    );
    assert.deepEqual(message[0]?.author_id, null);
    assert.equal(message[0]?.author_name, "Marta R.");
    assert.equal((await sql.query(`select 1 from "user" where "id" = 'u1'`)).length, 0);
    assert.equal((await sql.query("select 1 from creator_grant where user_id = 'u1'")).length, 0);
    await assert.rejects(deleteEmployee(sql, actor, "duena", "member"), WorkspaceAccessError);
  } finally {
    await pg.close();
  }
});

test("cancelar una invitación pendiente la anula", async () => {
  const { pg, sql } = await database();
  try {
    const actor = await owner(sql);
    const created = await createInvite(sql, actor, INPUT, NOW);
    await deleteEmployee(sql, actor, created.id, "invite");
    assert.equal((await inspectInvite(sql, created.token, NOW)).state, "revoked");
    assert.equal((await listEmployees(sql, NOW)).some((row) => row.kind === "invite"), false);
  } finally {
    await pg.close();
  }
});

test("correo: sin clave no falla y pide enviar el enlace a mano", async () => {
  const link = "http://localhost:8080/invitacion/abc";
  const noFetch = (async () => {
    throw new Error("no debe llamar a la red");
  }) as unknown as typeof fetch;
  assert.deepEqual(await sendInviteMail({ to: "a@b.es", name: "Ana", link }, {}, noFetch), { sent: false, reason: "no-key" });
  assert.deepEqual(await sendInviteMail({ to: "a@b.es", name: "Ana", link }, { RESEND_API_KEY: "  " }, noFetch), { sent: false, reason: "no-key" });
  assert.deepEqual(await sendInviteMail({ to: "a@b.es", name: "Ana", link }, { RESEND_API_KEY: "k" }, noFetch), { sent: false, reason: "no-from" });
});

test("correo: con clave llama a Resend con el enlace y no filtra errores", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const ok = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;
  const env = { RESEND_API_KEY: "re_test", FANLINK_MAIL_FROM: "Fanlink <hola@fanlink.es>" };
  const link = "http://localhost:8080/invitacion/abc";
  assert.deepEqual(await sendInviteMail({ to: "a@b.es", name: "Ana <b>", link }, env, ok), { sent: true });
  assert.equal(calls[0]?.url, "https://api.resend.com/emails");
  assert.equal((calls[0]?.init.headers as Record<string, string>).Authorization, "Bearer re_test");
  const body = JSON.parse(String(calls[0]?.init.body)) as { from: string; to: string[]; html: string; text: string };
  assert.equal(body.from, env.FANLINK_MAIL_FROM);
  assert.deepEqual(body.to, ["a@b.es"]);
  assert.match(body.text, /invitacion\/abc/);
  assert.doesNotMatch(body.html, /<b>/);

  const failing = (async () => new Response("clave mala", { status: 401 })) as unknown as typeof fetch;
  const result = await sendInviteMail({ to: "a@b.es", name: "Ana", link }, env, failing);
  assert.equal(result.sent, false);
  assert.equal(result.sent === false && result.reason, "provider-error");
  const down = (async () => {
    throw new Error("sin red");
  }) as unknown as typeof fetch;
  assert.equal((await sendInviteMail({ to: "a@b.es", name: "Ana", link }, env, down)).sent, false);
  assert.match(inviteEmail({ name: "Ana", link }).subject, /invitado/);
});

test("un miembro antiguo sin invitación sale en la lista con sus permisos, creadoras y avisos", async () => {
  const { pg, sql } = await database();
  try {
    await owner(sql);
    await sql.query("insert into staff_profile (user_id, display_name, role, perms) values ('viejo', 'Antiguo', 'member', '[\"mensajes\",\"vault\"]'::jsonb)");
    await sql.query("insert into creator_grant (user_id, creator_id) values ('viejo', 'allison')");
    await sql.query("insert into staff_alert (user_id, phone, alerts_enabled, quiet_minutes) values ('viejo', '+34600000000', true, 30)");
    const row = (await listEmployees(sql)).find((item) => item.id === "viejo");
    assert.deepEqual(
      row && { kind: row.kind, email: row.email, status: row.status, level: row.level, perms: row.perms, creatorIds: row.creatorIds, phone: row.phone, alertsEnabled: row.alertsEnabled, quietMinutes: row.quietMinutes },
      { kind: "member", email: null, status: "active", level: "chatter", perms: ["mensajes", "vault"], creatorIds: ["allison"], phone: "+34600000000", alertsEnabled: true, quietMinutes: 30 },
    );
    const ownerRow = (await listEmployees(sql)).find((item) => item.level === "owner");
    assert.equal(ownerRow?.perms.length, 7);
  } finally {
    await pg.close();
  }
});

test("una invitación guarda sus permisos y se pueden editar antes de aceptar", async () => {
  const { pg, sql } = await database();
  try {
    const actor = await owner(sql);
    const created = await createInvite(sql, actor, { ...INPUT, perms: ["mensajes", "vault"] }, NOW);
    await editEmployee(sql, actor, created.id, "invite", { name: "Marta", level: "analyst", creatorIds: ["jose"], perms: ["analitica"] });
    const invite = (await listEmployees(sql, NOW)).find((item) => item.kind === "invite");
    assert.deepEqual([invite?.name, invite?.level, invite?.creatorIds, invite?.perms], ["Marta", "analyst", ["jose"], ["analitica"]]);
    const claimed = await claimInvite(sql, created.token, NOW);
    assert.equal(claimed.ok && claimed.invite.perms.join(","), "analitica");
  } finally {
    await pg.close();
  }
});
