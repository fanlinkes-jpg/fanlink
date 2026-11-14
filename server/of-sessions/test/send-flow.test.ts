import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { chromium } from "playwright";
import { composeChat } from "../send/compose.ts";
import { deliverChatSend } from "../send/deliver.ts";
import { listPendingOutbounds, markOutboundError, markOutboundSent, recordOutbound } from "../sync/chat-store.ts";
import type { ReadSql } from "../sync/store.ts";
import { startFixture } from "./fixture-site.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const account = { creatorId: "9ikis52", accountId: "acc-9", handle: "bigpoppa1111", userId: "42", label: "Prueba" };

test("el texto y el precio se confirman con el id y un fallo no se reintenta", async () => {
  const fixture = await startFixture();
  const browser = await chromium.launch({ headless: true });
  try {
    const denied = await deliverChatSend({
      flag: "true",
      allowlist: "9ikis52,@bigpoppa1111",
      perMinute: 4,
      account: { ...account, creatorId: "otra", accountId: "acc-otra", handle: "otra", userId: "1", label: "Otra" },
      now: () => Date.now(),
      sleep: async () => undefined,
      open: async () => { throw new Error("no debía abrir"); },
    });
    assert.equal(denied.opened, false);
    assert.equal(denied.sent, false);

    const context = await browser.newContext();
    await context.addCookies([
      { name: "sess", value: "ok-1", url: fixture.origin },
      { name: "auth_id", value: "42", url: fixture.origin },
    ]);
    const open = () => composeChat(context, {
      chatsUrl: `${fixture.origin}/my/chats`,
      siteId: "onlyfans",
      threadKey: "7",
      fanKey: "7",
      accountUserId: "42",
      body: "Hola desde la prueba",
      priceCents: 500,
      typeDelayMs: 0,
      confirmMs: 8_000,
    });
    const sent = await deliverChatSend({
      flag: "true",
      allowlist: "@bigpoppa1111",
      perMinute: 4,
      account,
      now: () => Date.now(),
      sleep: async () => undefined,
      open,
    });
    assert.equal(sent.opened, true);
    assert.equal(sent.sent, true);
    assert.equal(sent.messageId, "300");
    assert.equal(fixture.composed.length, 1);
    assert.equal(fixture.composed[0]?.body, "Hola desde la prueba");
    assert.equal(fixture.composed[0]?.price, "5.00");

    fixture.confirmSends.on = false;
    fixture.composed.length = 0;
    const missed = await composeChat(context, {
      chatsUrl: `${fixture.origin}/my/chats`,
      siteId: "onlyfans",
      threadKey: "7",
      fanKey: "7",
      accountUserId: "42",
      body: "Esto no vuelve",
      priceCents: null,
      typeDelayMs: 0,
      confirmMs: 900,
    });
    assert.equal(missed.messageId, null);
    assert.equal(missed.reason, "no enviado");
    assert.equal(fixture.composed.length, 1);
    await context.close();
  } finally {
    await browser.close();
    await fixture.close();
  }
});

test("un enviado deja de estar pendiente y un error guarda el motivo", async () => {
  const db = new PGlite();
  const files = ["0007_of_reads.sql", "0008_sync_schedule.sql", "0009_of_chats.sql", "0013_chat_price.sql", "0018_chat_preview.sql", "0019_chat_author.sql", "0020_chat_card.sql", "0021_fan_profile.sql", "0022_message_media.sql", "0024_outbound_schedule.sql", "0025_outbound_send.sql", "0026_chat_history.sql", "0045_chat_unread_null.sql"];
  for (const file of files) await db.exec(await readFile(path.join(root, "migrations", file), "utf8"));
  const sql: ReadSql = {
    async query<T>(text: string, params?: unknown[]): Promise<T[]> {
      const result = await db.query<T>(text, params);
      return result.rows;
    },
  };
  await db.exec("insert into staff_profile (user_id, display_name, role) values ('e-1', 'Ana', 'owner')");
  await recordOutbound(sql, {
    id: "out-ok",
    createdAt: new Date().toISOString(),
    creatorId: "9ikis52",
    fanKey: "7",
    threadKey: "7",
    authorId: "e-1",
    body: "hola",
    priceCents: 500,
    ofMessageKey: null,
  });
  await markOutboundSent(sql, "out-ok", "300");
  assert.equal((await listPendingOutbounds(sql, ["9ikis52"])).length, 0);
  await recordOutbound(sql, {
    id: "out-bad",
    createdAt: new Date().toISOString(),
    creatorId: "9ikis52",
    fanKey: "7",
    threadKey: "7",
    authorId: "e-1",
    body: "fallo",
    priceCents: null,
    ofMessageKey: null,
  });
  await markOutboundError(sql, "out-bad", "No apareció el mensaje propio");
  await markOutboundError(sql, "out-bad", "otro motivo");
  const pending = await listPendingOutbounds(sql, ["9ikis52"]);
  assert.equal(pending.length, 1);
  assert.equal(pending[0]?.status, "error");
  assert.equal(pending[0]?.errorReason, "No apareció el mensaje propio");
  assert.equal(pending[0]?.authorName, "Ana");
});
