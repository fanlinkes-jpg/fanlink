import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { chromium } from "playwright";
import { claimSend, sendClaimKey } from "../send/claim.ts";
import { composeChat } from "../send/compose.ts";
import { sendChatMessageView, type SendChatHooks } from "../send/chat-message.ts";
import { attachmentsConfirmed, planVaultPieces, vaultPieceReady } from "../send/vault-piece.ts";
import type { ReadSql } from "../sync/store.ts";
import { startFixture } from "./fixture-site.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const VAULT_FILES = ["0037_vault_mirror.sql", "0038_vault_fan_filter.sql", "0039_outbound_media.sql", "0040_vault_full_tags.sql", "0041_send_claim.sql", "0042_vault_paid_with.sql"];
const SEND_FILES = ["0007_of_reads.sql", "0008_sync_schedule.sql", "0009_of_chats.sql", "0013_chat_price.sql", "0019_chat_author.sql", "0024_outbound_schedule.sql", "0025_outbound_send.sql", ...VAULT_FILES];

const account = { id: "acc-9", creatorId: "9ikis52", identityHandle: "bigpoppa1111", identityUserId: "42", identityState: "ok", label: "Prueba" };
const access = { userId: "chatter-a", role: "member" as const, perms: ["mensajes"], creatorIds: ["9ikis52"] };
const env = { FANLINK_ENABLE_SEND: "true", FANLINK_SEND_ALLOW_ACCOUNTS: "9ikis52,@bigpoppa1111" };

test("un título vacío o repetido no se señala, y el título solo no basta", () => {
  const mirror = [
    { id: "a", title: "playa", folder: "Playa", listName: "Playa", listId: "p" },
    { id: "b", title: "playa", folder: "Ciudad", listName: "Ciudad", listId: "c" },
    { id: "c", title: "  ", folder: "Playa", listName: "Playa", listId: "p" },
    { id: "d", title: "sola", folder: null, listName: null, listId: null },
  ];
  assert.equal(planVaultPieces(mirror, ["c"]).ok, false);
  assert.equal(planVaultPieces(mirror, ["a", "b"]).ok, false);
  assert.equal(planVaultPieces(mirror, ["a"]).ok, true);
  const one = planVaultPieces(mirror, ["a"]);
  assert.equal(one.ok && one.pieces[0]?.folder, "Playa");
  assert.equal(planVaultPieces(mirror, ["d"]).ok, true);
  assert.equal(planVaultPieces([
    { id: "a", title: "igual", folder: "Playa", listName: null, listId: null },
    { id: "b", title: "igual", folder: "Playa", listName: null, listId: null },
  ], ["a"]).ok, false);
  assert.equal(vaultPieceReady({ id: "a", title: "playa", folder: "Playa" }, [{ id: null, title: "playa", folder: null }]), false);
  assert.equal(vaultPieceReady({ id: "a", title: "playa", folder: "Playa" }, [{ id: null, title: "playa", folder: "Playa" }]), true);
  assert.equal(vaultPieceReady({ id: "a", title: "playa", folder: "Playa" }, [{ id: "otro", title: "playa", folder: "Playa" }]), false);
  assert.equal(vaultPieceReady({ id: "a", title: "otra", folder: null }, [{ id: "a", title: "distinto", folder: "X" }]), true);
  assert.equal(attachmentsConfirmed(1, 1), true);
  assert.equal(attachmentsConfirmed(0, 1), false);
  assert.equal(attachmentsConfirmed(2, 1), false);
});

test("vaultTitle de una pieza NO VENDER, sin ids, no envía y no abre el navegador", async () => {
  const db = new PGlite();
  try {
    await apply(db, VAULT_FILES);
    await db.exec(`insert into of_vault_list (creator_id, list_key, name) values ('9ikis52', 'nv', 'NO VENDER')`);
    await db.exec(`insert into of_vault_item (creator_id, item_key, title, folder, list_key, list_name) values ('9ikis52', 'v1', 'clip', 'NO VENDER', 'nv', 'NO VENDER')`);
    let opened = false;
    const attack = {
      creatorId: "9ikis52",
      fanKey: "7",
      threadKey: "7",
      body: "hola",
      priceCents: null,
      vaultTitle: "clip",
    };
    const result = await sendChatMessageView("chatter-a", attack, hooks(asSql(db), async () => {
      opened = true;
      return { messageId: "1", reason: null, attachedIds: ["v1"] };
    }));
    assert.equal(result.sent, false);
    assert.equal(result.reason, "NO VENDER");
    assert.equal(opened, false);
    assert.equal(await count(db, "of_vault_fan_send"), 0);
  } finally {
    await db.close();
  }
});

test("sin título o con el título repetido no se abre el navegador ni se escribe el historial", async () => {
  const db = new PGlite();
  try {
    await apply(db, VAULT_FILES);
    await db.exec(`insert into of_vault_item (creator_id, item_key, title, folder, list_name) values
      ('9ikis52', 'vacia', '', 'Playa', 'Playa'),
      ('9ikis52', 'a', 'mismo', 'Playa', 'Playa'),
      ('9ikis52', 'b', 'mismo', 'Ciudad', 'Ciudad'),
      ('9ikis52', 'c', 'igual', 'Playa', 'Playa'),
      ('9ikis52', 'd', 'igual', 'Playa', 'Playa')`);
    let opened = false;
    const open = async () => {
      opened = true;
      return { messageId: "1", reason: null, attachedIds: ["vacia"] };
    };
    const empty = await sendChatMessageView("chatter-a", {
      creatorId: "9ikis52", fanKey: "7", threadKey: "7", body: "hola", priceCents: null, vaultItemIds: ["vacia"],
    }, hooks(asSql(db), open));
    assert.equal(empty.sent, false);
    assert.equal(empty.reason, "Sin datos");
    assert.equal(opened, false);
    const shared = await sendChatMessageView("chatter-a", {
      creatorId: "9ikis52", fanKey: "7", threadKey: "7", body: "hola", priceCents: null, vaultItemIds: ["a", "b"],
    }, hooks(asSql(db), open));
    assert.equal(shared.sent, false);
    assert.equal(shared.reason, "Sin datos");
    assert.equal(opened, false);
    const sameFolder = await sendChatMessageView("chatter-a", {
      creatorId: "9ikis52", fanKey: "7", threadKey: "7", body: "hola", priceCents: null, vaultItemIds: ["c"],
    }, hooks(asSql(db), open));
    assert.equal(sameFolder.reason, "Sin datos");
    assert.equal(opened, false);
    assert.equal(await count(db, "of_vault_fan_send"), 0);
  } finally {
    await db.close();
  }
});

test("el historial solo anota las piezas adjuntadas y dos envíos iguales no salen a la vez", async () => {
  const db = new PGlite();
  try {
    await apply(db, SEND_FILES);
    await db.exec(`insert into staff_profile (user_id, display_name, role) values ('chatter-a', 'Ana', 'member')`);
    await db.exec(`insert into of_vault_item (creator_id, item_key, title, folder, list_name) values
      ('9ikis52', 'libre', 'playa', 'Playa', 'Playa'),
      ('9ikis52', 'otra', 'ciudad', 'Ciudad', 'Ciudad')`);
    const sql = asSql(db);
    let opened = 0;
    const sent = await sendChatMessageView("chatter-a", {
      creatorId: "9ikis52", fanKey: "7", threadKey: "7", body: "una", priceCents: null, vaultItemIds: ["libre", "otra"],
    }, hooks(sql, async () => {
      opened += 1;
      return { messageId: "1", reason: null, attachedIds: ["libre"] };
    }));
    assert.equal(sent.sent, true);
    assert.equal(opened, 1);
    const noted = await db.query<{ item_key: string }>("select item_key from of_vault_fan_send order by item_key");
    assert.deepEqual(noted.rows.map((row) => row.item_key), ["libre"]);
    const again = await sendChatMessageView("chatter-a", {
      creatorId: "9ikis52", fanKey: "7", threadKey: "7", body: "una", priceCents: null, vaultItemIds: ["libre", "otra"],
    }, hooks(sql, async () => {
      opened += 1;
      return { messageId: "2", reason: null, attachedIds: ["libre", "otra"] };
    }));
    assert.equal(again.sent, false);
    assert.equal(again.reason, "Ya se está enviando");
    assert.equal(opened, 1);
    assert.equal(await count(db, "of_chat_outbound"), 1);
    const failed = await sendChatMessageView("chatter-a", {
      creatorId: "9ikis52", fanKey: "7", threadKey: "7", body: "reintento", priceCents: null, vaultItemIds: ["otra"],
    }, hooks(sql, async () => ({ messageId: null, reason: "no enviado" })));
    assert.equal(failed.sent, false);
    const retry = await sendChatMessageView("chatter-a", {
      creatorId: "9ikis52", fanKey: "7", threadKey: "7", body: "reintento", priceCents: null, vaultItemIds: ["otra"],
    }, hooks(sql, async () => {
      opened += 1;
      return { messageId: "3", reason: null, attachedIds: ["otra"] };
    }));
    assert.equal(retry.sent, true);
    assert.equal(opened, 2);
    const at = new Date("2026-11-07T10:00:00.000Z");
    const key = sendClaimKey({ creatorId: "c", threadKey: "1", fanKey: null, body: "x", priceCents: null, vaultItemIds: [] });
    assert.equal(await claimSend(sql, key, "a", at), true);
    assert.equal(await claimSend(sql, key, "b", new Date(at.getTime() + 10_000)), false);
    assert.equal(await claimSend(sql, key, "c", new Date(at.getTime() + 31_000)), true);
  } finally {
    await db.close();
  }
});

test("dos pestañas no abren el navegador dos veces", async () => {
  const db = new PGlite();
  try {
    await apply(db, SEND_FILES);
    await db.exec(`insert into staff_profile (user_id, display_name, role) values ('chatter-a', 'Ana', 'member')`);
    await db.exec(`insert into of_vault_item (creator_id, item_key, title, folder) values ('9ikis52', 'libre', 'playa', 'Playa')`);
    const sql = asSql(db);
    let opened = 0;
    let release: () => void = () => undefined;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const input = { creatorId: "9ikis52", fanKey: "7", threadKey: "7", body: "a la vez", priceCents: null as number | null, vaultItemIds: ["libre"] };
    const first = sendChatMessageView("chatter-a", input, hooks(sql, async () => {
      opened += 1;
      await hold;
      return { messageId: "1", reason: null, attachedIds: ["libre"] };
    }));
    for (let i = 0; i < 50 && opened === 0; i += 1) await delay(20);
    assert.equal(opened, 1);
    const second = await sendChatMessageView("chatter-a", input, hooks(sql, async () => {
      opened += 1;
      return { messageId: "2", reason: null, attachedIds: ["libre"] };
    }));
    assert.equal(second.sent, false);
    assert.equal(second.reason, "Ya se está enviando");
    assert.equal(opened, 1);
    release();
    const done = await first;
    assert.equal(done.sent, true);
    assert.equal(await count(db, "of_chat_outbound"), 1);
    assert.equal(await count(db, "of_vault_fan_send"), 1);
  } finally {
    await db.close();
  }
});

test("el compositor comprueba el adjunto antes de pulsar Send", async () => {
  const fixture = await startFixture();
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    await context.addCookies([
      { name: "sess", value: "ok-1", url: fixture.origin },
      { name: "auth_id", value: "42", url: fixture.origin },
    ]);
    const base = {
      chatsUrl: `${fixture.origin}/my/chats`,
      siteId: "onlyfans",
      threadKey: "9",
      fanKey: "9",
      accountUserId: "42",
      body: "con pieza",
      priceCents: null,
      typeDelayMs: 0,
      confirmMs: 2_000,
      settleMs: 400,
    };
    const missing = await composeChat(context, { ...base, vaultPieces: [{ id: "ausente", title: "playa", folder: "Playa" }] });
    assert.equal(missing.messageId, null);
    assert.match(missing.reason ?? "", /adjuntar/);
    assert.equal(fixture.composed.length, 0);
    const broken = await composeChat(context, { ...base, vaultPieces: [{ id: "roto", title: "roto", folder: "Playa" }] });
    assert.equal(broken.messageId, null);
    assert.equal(fixture.composed.length, 0);
    const sent = await composeChat(context, { ...base, vaultPieces: [{ id: "playa-1", title: "playa", folder: "Playa" }] });
    assert.equal(sent.messageId, "300");
    assert.deepEqual(sent.attachedIds, ["playa-1"]);
    assert.equal(fixture.composed.length, 1);
    const byFolder = await composeChat(context, { ...base, body: "norte", vaultPieces: [{ id: "norte-id", title: "norte", folder: "Norte" }] });
    assert.match(byFolder.messageId ?? "", /^30\d$/);
    assert.deepEqual(byFolder.attachedIds, ["norte-id"]);
    assert.equal(fixture.composed.length, 2);
  } finally {
    await browser.close();
    await fixture.close();
  }
});

function hooks(sql: ReadSql, open: SendChatHooks["open"]): SendChatHooks {
  return { sql, access, account, env, open };
}

function asSql(db: PGlite): ReadSql {
  return {
    async query<T>(text: string, params?: unknown[]): Promise<T[]> {
      const result = await db.query<T>(text, params);
      return result.rows;
    },
  };
}

async function apply(db: PGlite, files: readonly string[]): Promise<void> {
  for (const file of files) await db.exec(await readFile(path.join(root, "migrations", file), "utf8"));
}

async function count(db: PGlite, table: string): Promise<number> {
  const result = await db.query<{ n: number }>(`select count(*)::int as n from ${table}`);
  return Number(result.rows[0]?.n ?? 0);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
