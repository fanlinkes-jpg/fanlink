import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import {
  assertCreatorAccess,
  assertWorkspaceChange,
  canAccessCreator,
  canSeeAgencyEarnings,
  creatorIdsForChats,
  mergeScopedWorkspace,
  scopeWorkspaceFor,
  WorkspaceAccessError,
  type TeamAccess,
  type WorkspaceSlice,
} from "./access-policy.ts";
import { dashboardCreatorIds, visibleCreators } from "./dashboard-config.ts";
import { chatUnreadTotal, creatorChipBadges, inboxThreadList, resolveInboxCreator, unreadBubbleText } from "./inbox-scope.ts";
import { canReadCreatorNotifications, visibleNotifications } from "./notifications.ts";
import { commitWorkspace, ensureStaff, setCreatorGrant, setStaffPerms } from "./workspace-store.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const owner: TeamAccess = { userId: "dueña", role: "owner", perms: [], creatorIds: [] };
const chatter: TeamAccess = { userId: "chatter", role: "member", perms: ["mensajes", "vault", "campanas"], creatorIds: ["c-alba", "c-nora"] };
const ALL = ["c-alba", "c-nora", "c-tercera"];

function creator(id: string, extra: Record<string, unknown> = {}) {
  return { id, name: id, revenue30: 900, split: 30, ...extra };
}

function fullWorkspace(): WorkspaceSlice {
  return {
    agency: "Fanlink",
    creators: ALL.map((id) => creator(id)),
    fans: ALL.map((id) => ({ id: `f-${id}`, creatorId: id, name: `fan ${id}` })),
    messages: ALL.map((id) => ({ id: `m-${id}`, creatorId: id, text: `hola ${id}` })),
    vault: ALL.map((id) => ({ id: `v-${id}`, creatorId: id, title: `pack ${id}` })),
    scripts: [],
    lists: [],
    campaigns: [{ id: "camp", name: "Black Friday", earned: 5000 }],
    employees: [],
    links: ALL.map((id) => ({ id: `l-${id}`, creatorId: id, name: id })),
    automations: [],
    history: [{ day: "2026-11-01", euros: 1234 }],
    stopWords: [],
    copilot: true,
    translate: true,
    adaptPrices: true,
    notifyShifts: true,
  };
}

function field(record: unknown, key: string): unknown {
  return (record as Record<string, unknown>)[key];
}

function ids(records: Array<{ id: string }>): string[] {
  return records.map((record) => record.id);
}

test("chats, fichas, bóveda y contadores: el miembro solo recibe las cuentas asignadas y la dueña todas", () => {
  assert.deepEqual(creatorIdsForChats(chatter, ALL), ["c-alba", "c-nora"]);
  assert.deepEqual(creatorIdsForChats(owner, ALL), ALL);
  assert.deepEqual(creatorIdsForChats({ ...chatter, creatorIds: [] }, ALL), []);
  assert.deepEqual(creatorIdsForChats(null, ALL), []);
  assert.equal(canAccessCreator(chatter, "c-tercera"), false);
  assert.equal(canAccessCreator(owner, "c-tercera"), true);
  assert.equal(canAccessCreator(chatter, ""), false);
  assert.throws(() => assertCreatorAccess(chatter, "c-tercera"), WorkspaceAccessError);
  assert.doesNotThrow(() => assertCreatorAccess(chatter, "c-nora"));
});

test("un miembro nunca ve totales de la agencia", () => {
  assert.equal(canSeeAgencyEarnings(chatter), false);
  assert.equal(canSeeAgencyEarnings(owner), true);
  assert.equal(canSeeAgencyEarnings(null), false);
});

test("el espacio compartido llega recortado: sin la tercera creadora, sin comisión, sin histórico y sin ingresos de campañas", () => {
  const view = scopeWorkspaceFor(chatter, fullWorkspace());
  for (const list of [view.creators, view.fans, view.messages, view.vault, view.links]) {
    assert.equal(list.length, 2);
    assert.equal(JSON.stringify(list).includes("c-tercera"), false);
  }
  assert.deepEqual(view.history, []);
  assert.deepEqual(view.creators.map((row) => field(row, "split")), [0, 0]);
  assert.deepEqual(view.creators.map((row) => field(row, "revenue30")), [null, null]);
  assert.equal((view.campaigns[0] as { earned: number }).earned, 0);
  assert.equal(JSON.stringify(view).includes("1234"), false);
  assert.equal(JSON.stringify(view).includes("5000"), false);
  const whole = fullWorkspace();
  assert.equal(scopeWorkspaceFor(owner, whole), whole);
  assert.deepEqual(scopeWorkspaceFor(null, whole).creators, []);
});

test("guardar lo recibido no borra lo que el miembro no ve ni deja colar la tercera", () => {
  const prev = fullWorkspace();
  const seen = scopeWorkspaceFor(chatter, prev);
  const merged = mergeScopedWorkspace(chatter, prev, seen);
  assert.deepEqual(merged, prev);
  const forged = { ...seen, fans: [...seen.fans, { id: "f-nuevo", creatorId: "c-tercera", name: "intruso" }] };
  const forgedMerge = mergeScopedWorkspace(chatter, prev, forged);
  assert.equal(ids(forgedMerge.fans).includes("f-nuevo"), true);
  assert.throws(() => mergeAndCheck(forged), /fans de esa creadora/);
  const rewrite = { ...seen, fans: [...seen.fans, { id: "f-c-tercera", creatorId: "c-tercera", name: "pisado" }] };
  assert.throws(() => mergeAndCheck(rewrite), /fans de esa creadora/);
});

function mergeAndCheck(next: WorkspaceSlice): void {
  const prev = fullWorkspace();
  assertWorkspaceChange(chatter, prev, mergeScopedWorkspace(chatter, prev, next));
}

test("dashboard y badges: un miembro cuenta solo sus cuentas, también la burbuja del menú", () => {
  const accounts = ALL.map((creatorId) => ({ creatorId }));
  assert.deepEqual(dashboardCreatorIds(chatter, accounts), ["c-alba", "c-nora"]);
  assert.deepEqual(dashboardCreatorIds(owner, accounts), ALL);
  const people = ALL.map((id) => ({ id }));
  assert.deepEqual(visibleCreators(chatter, people).map((row) => row.id), ["c-alba", "c-nora"]);
  const threads = [
    { creatorId: "c-alba", unread: 3 },
    { creatorId: "c-nora", unread: 2 },
    { creatorId: "c-tercera", unread: 40 },
  ];
  const visibleIds = visibleCreators(chatter, people).map((row) => row.id);
  const badges = creatorChipBadges({ threads, notices: [], visibleIds, ofChats: [{ creatorId: "c-tercera", count: 77 }] });
  assert.deepEqual(Object.keys(badges).sort(), ["c-alba", "c-nora"]);
  assert.equal(chatUnreadTotal({ threads, visibleIds, ofChats: [{ creatorId: "c-tercera", count: 77 }] }), 5);
  assert.equal(unreadBubbleText(chatUnreadTotal({ threads, visibleIds })), "5");
});

test("por URL directa o por id, una cuenta no asignada no abre la bandeja", () => {
  const creators = [{ id: "c-alba" }, { id: "c-nora" }];
  assert.equal(resolveInboxCreator({ requested: "c-tercera", creators, remembered: "c-tercera" }), "c-alba");
  const list = inboxThreadList(
    [{ creatorId: "c-alba", id: 1 }, { creatorId: "c-tercera", id: 2 }],
    { requested: "c-tercera", creators, remembered: null },
  );
  assert.equal(list.creatorId, "c-alba");
  assert.deepEqual(list.threads.map((row) => row.id), [1]);
});

test("notificaciones: un miembro no lee las de una cuenta no asignada", () => {
  assert.equal(canReadCreatorNotifications(chatter, "c-nora"), true);
  assert.equal(canReadCreatorNotifications(chatter, "c-tercera"), false);
  assert.equal(canReadCreatorNotifications(owner, "c-tercera"), true);
  const rows = [{ creatorId: "c-tercera", kind: "like", key: "k" }] as unknown as Parameters<typeof visibleNotifications>[0];
  assert.deepEqual(visibleNotifications(rows, chatter, "c-tercera"), []);
});

async function database() {
  const dir = await mkdtemp(path.join(tmpdir(), "fanlink-scope-"));
  const pg = new PGlite(dir);
  for (const name of ["0002_workspace.sql", "0003_of_sessions.sql", "0004_staff_and_connection.sql"]) {
    await pg.exec(await readFile(path.join(root, "migrations", name), "utf8"));
  }
  return { pg, sql: { query: async <T>(text: string, params: unknown[] = []) => (await pg.query<T>(text, params)).rows } };
}

test("en la base: carga, conflicto y guardado de un miembro con 2 de 3 creadoras", async () => {
  const { pg, sql } = await database();
  try {
    const boss = await ensureStaff(sql, "dueña", false);
    assert.equal(boss.role, "owner");
    const first = await commitWorkspace(sql, boss.userId, 0, fullWorkspace(), boss);
    assert.equal(first.ok, true);
    if (!first.ok) return;
    const member = await ensureStaff(sql, "chatter", false);
    assert.equal(member.role, "member");
    await setStaffPerms(sql, boss, "chatter", ["mensajes", "vault"]);
    await setCreatorGrant(sql, boss, "chatter", "c-alba", true);
    await setCreatorGrant(sql, boss, "chatter", "c-nora", true);
    const access = await ensureStaff(sql, "chatter", false);
    assert.deepEqual(access.creatorIds, ["c-alba", "c-nora"]);

    // Un conflicto devuelve el estado recortado, no el de la agencia.
    const stale = await commitWorkspace(sql, "chatter", first.version - 1, scopeWorkspaceFor(access, fullWorkspace()), access);
    assert.equal(stale.ok, false);
    if (!stale.ok && stale.reason === "conflict") {
      const text = JSON.stringify(stale.state);
      assert.equal(text.includes("c-tercera"), false);
      assert.equal(text.includes("1234"), false);
      assert.equal(text.includes("5000"), false);
    }

    // Guardar lo que recibió conserva lo del resto.
    const edited = scopeWorkspaceFor(access, fullWorkspace());
    const nota = { ...edited.fans[0], name: "con nota" };
    const saved = await commitWorkspace(sql, "chatter", first.version, { ...edited, fans: [nota, ...edited.fans.slice(1)] }, access);
    assert.equal(saved.ok, true, JSON.stringify(saved));
    const stored = await pg.query<{ state: WorkspaceSlice }>("select state from workspace_state where id = 1");
    const state = stored.rows[0]?.state;
    assert.ok(state);
    assert.equal(state.fans.length, 3);
    assert.equal(state.creators.length, 3);
    assert.equal(state.history.length, 1);
    assert.equal(field(state.creators[0], "revenue30"), 900);
    assert.equal(field(state.creators[0], "split"), 30);
    assert.equal((state.campaigns[0] as { earned: number }).earned, 5000);
    assert.equal(field(state.fans.find((fan) => fan.id === "f-c-alba"), "name"), "con nota");

    // Tocar la tercera se rechaza y no cambia nada.
    if (!saved.ok) return;
    const attack = { ...edited, fans: [...edited.fans, { id: "f-nuevo", creatorId: "c-tercera", name: "intruso" }] };
    const denied = await commitWorkspace(sql, "chatter", saved.version, attack, access);
    assert.equal(denied.ok, false);
    if (!denied.ok) assert.equal(denied.reason, "forbidden");

    // La dueña sigue viéndolo todo.
    const own = await commitWorkspace(sql, boss.userId, saved.version - 1, fullWorkspace(), boss);
    assert.equal(own.ok, false);
    if (!own.ok && own.reason === "conflict") assert.equal(own.state?.fans.length, 3);
  } finally {
    await pg.close();
  }
});
