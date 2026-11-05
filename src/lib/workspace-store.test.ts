import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { emptyWorkspace, type TeamAccess, type WorkspaceSlice } from "./access-policy.ts";
import { commitWorkspace, ensureStaff, setCreatorGrant, setStaffPerms } from "./workspace-store.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

async function database() {
  const dir = await mkdtemp(path.join(tmpdir(), "fanlink-workspace-"));
  const pg = new PGlite(dir);
  for (const name of ["0002_workspace.sql", "0003_of_sessions.sql", "0004_staff_and_connection.sql"]) {
    await pg.exec(await readFile(path.join(root, "migrations", name), "utf8"));
  }
  const sql = {
    query: async <T>(text: string, params: unknown[] = []) => (await pg.query<T>(text, params)).rows,
  };
  return { dir, pg, sql };
}

function slice(name: string): WorkspaceSlice {
  return { ...emptyWorkspace(), agency: name };
}

test("dos clientes no se pisan: la versión vieja pierde", async () => {
  const { pg, sql } = await database();
  try {
    const owner = await ensureStaff(sql, "dueña", false);
    assert.equal(owner.role, "owner");
    const first = await commitWorkspace(sql, owner.userId, 0, slice("Uno"), owner);
    assert.equal(first.ok, true);
    if (!first.ok) return;
    const winner = await commitWorkspace(sql, owner.userId, first.version, slice("Dos"), owner);
    const loser = await commitWorkspace(sql, owner.userId, first.version, slice("Tres"), owner);
    assert.equal(winner.ok, true);
    assert.equal(loser.ok, false);
    if (loser.ok) return;
    assert.equal(loser.reason, "conflict");
    assert.equal(loser.state && "agency" in loser.state ? loser.state.agency : "", "Dos");
    if (!winner.ok) return;
    const [left, right] = await Promise.all([
      commitWorkspace(sql, owner.userId, winner.version, slice("Izquierda"), owner),
      commitWorkspace(sql, owner.userId, winner.version, slice("Derecha"), owner),
    ]);
    const oks = [left, right].filter((item) => item.ok);
    const conflicts = [left, right].filter((item) => !item.ok);
    assert.equal(oks.length, 1);
    assert.equal(conflicts.length, 1);
  } finally {
    await pg.close();
  }
});

test("el workspace sobrevive a cerrar y reabrir PGLite", async () => {
  const { dir, pg, sql } = await database();
  const owner = await ensureStaff(sql, "dueña", false);
  await commitWorkspace(sql, owner.userId, 0, slice("Persiste"), owner);
  await pg.close();
  const again = new PGlite(dir);
  try {
    const rows = await again.query<{ state: { agency: string } }>("select state from workspace_state where id = 1");
    assert.equal(rows.rows[0]?.state.agency, "Persiste");
  } finally {
    await again.close();
  }
});

test("un miembro sin permiso no guarda y la dueña sí asigna", async () => {
  const { pg, sql } = await database();
  try {
    const owner = await ensureStaff(sql, "dueña", false);
    await ensureStaff(sql, "chatter", false);
    const chatter = await ensureStaff(sql, "chatter", false);
    assert.equal(chatter.role, "member");
    const denied = await commitWorkspace(sql, chatter.userId, 0, slice("No"), chatter);
    assert.equal(denied.ok, false);
    if (denied.ok) return;
    assert.equal(denied.reason, "forbidden");
    const created = await commitWorkspace(sql, owner.userId, 0, { ...emptyWorkspace(), creators: [{ id: "c-alba", creatorId: "c-alba" }] }, owner);
    assert.equal(created.ok, true);
    await setCreatorGrant(sql, owner, chatter.userId, "c-alba", true);
    await setStaffPerms(sql, owner, chatter.userId, ["mensajes"]);
    const granted = await ensureStaff(sql, chatter.userId, false);
    const member: TeamAccess = granted;
    assert.equal(member.creatorIds.includes("c-alba"), true);
    assert.equal(member.perms.includes("mensajes"), true);
    await assert.rejects(() => setStaffPerms(sql, member, owner.userId, ["mensajes"]), /dueña/);
  } finally {
    await pg.close();
  }
});
