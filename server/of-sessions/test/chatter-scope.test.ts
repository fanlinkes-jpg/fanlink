import assert from "node:assert/strict";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { WorkspaceAccessError } from "../../../src/lib/access-policy.ts";
import { handleChatMedia, handleVaultMedia, handleVaultQuery, handleVaultSend } from "../http/vault-http.ts";
import { scopedCreatorIds } from "../http/vault-accounts.ts";
import { dashboardViewFor } from "../metrics/dashboard.ts";
import { liveViewSectionAccess } from "../live/sections.ts";
import { visibleOnlineCreatorIds } from "../send/online-broadcast.ts";
import { sendChatMessageView } from "../send/chat-message.ts";
import { bindSignedViews, markChatOpenedView, readVisibleFanSpendView } from "../sync/signed-views.ts";
import { creatorAllowed, queryVaultForActor } from "../sync/vault-query.ts";
import type { ReadSql } from "../sync/store.ts";

// Un chatter con 2 de 3 creadoras. La tercera es `c-tercera`.
const chatter = { userId: "chatter", role: "member" as const, perms: ["mensajes", "vault"], creatorIds: ["c-alba", "c-nora"] };
const owner = { userId: "dueña", role: "owner" as const, perms: [] as string[], creatorIds: [] as string[] };

/** Cualquier lectura de datos revienta: una ruta cerrada no puede tocar la base. */
const forbiddenSql: ReadSql = {
  async query(): Promise<never> {
    throw new Error("la ruta cerrada leyó la base");
  },
};

function post(body: unknown): Request {
  return new Request("http://local/api", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

test("bóveda: creatorAllowed falla cerrado para un miembro y deja pasar a la dueña", () => {
  assert.equal(creatorAllowed(chatter, "c-alba"), true);
  assert.equal(creatorAllowed(chatter, "c-tercera"), false);
  assert.equal(creatorAllowed({ userId: "x", role: "member", perms: ["vault"] }, "c-alba"), false);
  assert.equal(creatorAllowed(owner, "c-tercera"), true);
  assert.equal(creatorAllowed(owner, ""), false);
});

test("bóveda: la consulta por id de una cuenta no asignada responde 403 sin leer la base", async () => {
  const direct = await queryVaultForActor(forbiddenSql, chatter, { creatorId: "c-tercera" });
  assert.equal(direct.status, 403);
  assert.deepEqual(direct.payload.items, []);
  const viaHttp = await handleVaultQuery(post({ creatorId: "c-tercera", query: null }), { session: async () => chatter, sql: forbiddenSql });
  assert.equal(viaHttp.status, 403);
  // Si la ruta no pasa la lista de cuentas, un miembro tampoco entra.
  const noList = await queryVaultForActor(forbiddenSql, { userId: "x", role: "member", perms: ["vault"] }, { creatorId: "c-alba" });
  assert.equal(noList.status, 403);
});

test("bóveda: la lista de cuentas de las rutas /api recorta a las asignadas", async () => {
  const db = new PGlite();
  try {
    await db.exec("create table of_session_account (creator_id text)");
    await db.exec("insert into of_session_account values ('c-alba'), ('c-nora'), ('c-tercera')");
    const sql: ReadSql = { async query<T>(text: string, params?: unknown[]) { return (await db.query<T>(text, params)).rows; } };
    assert.deepEqual(await scopedCreatorIds(sql, chatter), ["c-alba", "c-nora"]);
    assert.deepEqual(await scopedCreatorIds(sql, owner), ["c-alba", "c-nora", "c-tercera"]);
  } finally {
    await db.close();
  }
});

test("medios del chat y de la bóveda: la tercera cuenta da 403 y no pide el archivo", async () => {
  let asked = 0;
  const actor = { ...chatter };
  const chat = await handleChatMedia(
    new Request("http://local/api/chat-media?creatorId=c-tercera&threadKey=1&messageKey=m&index=0"),
    { session: async () => actor, findMedia: async () => { asked += 1; return { url: "https://cdn2.onlyfans.com/x.jpg" }; }, fetchBytes: async () => { asked += 1; return null; } },
  );
  assert.equal(chat.status, 403);
  const vault = await handleVaultMedia(
    new Request("http://local/api/vault-media?creatorId=c-tercera&mediaId=9"),
    { session: async () => actor, findPreview: async () => { asked += 1; return "https://cdn2.onlyfans.com/x.jpg"; }, fetchBytes: async () => { asked += 1; return null; } },
  );
  assert.equal(vault.status, 403);
  assert.equal(asked, 0);
});

test("envío desde la bóveda: sin cuenta, o con la tercera, un miembro recibe 403; la dueña sin cuenta pasa", async () => {
  const env = { FANLINK_ENABLE_SEND: "false", FANLINK_ENABLE_MASS_SEND: "false", FANLINK_SEND_ALLOW_ACCOUNTS: "" };
  for (const body of [{ creatorId: "c-tercera", itemIds: ["1"] }, { mode: "mass", accountId: "acc-3", itemIds: ["1"] }]) {
    const denied = await handleVaultSend(post(body), { session: async () => chatter, sql: forbiddenSql, env });
    assert.equal(denied.status, 403);
  }
  const ownerRun = await handleVaultSend(post({ mode: "mass", accountId: "acc-3", itemIds: [] }), { session: async () => owner, sql: forbiddenSql, env });
  assert.notEqual(ownerRun.status, 403);
});

test("envío de un mensaje: un miembro no escribe en la tercera cuenta aunque el servidor conozca la sesión", async () => {
  let opened = 0;
  const account = { id: "acc-3", creatorId: "c-tercera", identityHandle: "tercera", identityUserId: "3", identityState: "ok", label: "Tercera" };
  const result = await sendChatMessageView("chatter", { creatorId: "c-tercera", fanKey: "7", threadKey: "7", body: "hola", priceCents: null }, {
    sql: forbiddenSql,
    access: chatter,
    account,
    env: { FANLINK_ENABLE_SEND: "true", FANLINK_SEND_ALLOW_ACCOUNTS: "c-tercera" },
    open: async () => {
      opened += 1;
      return { messageId: "1", reason: null, attachedIds: [] };
    },
  });
  assert.equal(opened, 0);
  assert.deepEqual(result, { sent: false, reason: "Sin datos", messageId: null });
});

test("lecturas firmadas: gasto del fan y marcar abierto exigen la cuenta asignada", async () => {
  let touched = 0;
  bindSignedViews({
    accessFor: async () => chatter,
    sessions: async () => {
      touched += 1;
      throw new Error("no debe abrir sesiones");
    },
    sql: async () => forbiddenSql,
  });
  await assert.rejects(readVisibleFanSpendView("chatter", { creatorId: "c-tercera", fanIds: ["1"] }), WorkspaceAccessError);
  await assert.rejects(markChatOpenedView("chatter", { creatorId: "c-tercera", threadKey: "1" }), WorkspaceAccessError);
  assert.equal(touched, 0);
});

test("fans en línea: «todas» y por id solo devuelven las cuentas asignadas", () => {
  const known = ["c-alba", "c-nora", "c-tercera"];
  assert.deepEqual(visibleOnlineCreatorIds(chatter, "all", known), ["c-alba", "c-nora"]);
  assert.deepEqual(visibleOnlineCreatorIds(chatter, "c-tercera", known), []);
  assert.deepEqual(visibleOnlineCreatorIds(owner, "all", known), known);
});

test("dashboard: un miembro no recibe euros ni la tercera cuenta; la dueña sí", () => {
  const accounts = ["c-alba", "c-nora", "c-tercera"].map((creatorId) => ({ id: `a-${creatorId}`, creatorId, label: creatorId, status: "active", connection: "ok" }));
  const now = new Date("2026-11-28T10:00:00Z");
  const read = (creatorId: string) => ({
    creatorId,
    earningsSyncedAt: now.toISOString(),
    fansSyncedAt: now.toISOString(),
    lastStatus: "ok",
    lastReason: null,
    earnings: [{ day: "2026-11-28", kind: "tips", amountCents: 70_000, currency: "USD" }],
    fans: [],
    transactions: [{ txKey: `t-${creatorId}`, occurredAt: now.toISOString(), grossCents: 70_000, netCents: 56_000, kind: "tip", fanKey: "f", currency: "USD" }],
  });
  const reads = accounts.map((account) => read(account.creatorId));
  const view = dashboardViewFor({ access: chatter, accounts, reads, pauses: [], now });
  assert.equal(view.dayGrossCents, null);
  assert.equal(view.monthGrossCents, null);
  assert.equal(JSON.stringify(view).includes("c-tercera"), false);
  const boss = dashboardViewFor({ access: owner, accounts, reads, pauses: [], now });
  assert.notEqual(boss.monthGrossCents, null);
});

test("Operaciones y sus secciones (Banco, Estadísticas, Estados de cuenta) no se abren a un miembro", () => {
  assert.equal(liveViewSectionAccess("notifications", "member").ok, false);
  assert.equal(liveViewSectionAccess("notifications", "owner").ok, true);
});
