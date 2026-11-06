import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { listPendingOutbounds, markOutboundAwaiting, markOutboundSent, outboundSendStateReady, reconcileOutboundBatch, reconcilePendingOutbound, recordOutbound, saveChatRead } from "../sync/chat-store.ts";
import type { ReadSql } from "../sync/store.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

test("otro hilo o un mensaje del fan no marcan el envío, y el propio se reconcilia", () => {
  const created = "2026-11-06T12:00:00.000Z";
  const later = "2026-11-06T12:03:00.000Z";
  const now = Date.parse("2026-11-06T12:04:00.000Z");
  const draft = {
    id: "out-1",
    authorId: "ana",
    body: "hola",
    priceCents: null,
    createdAt: created,
    threadKey: "7",
    fanKey: "7",
    ofMessageKey: null,
    errorReason: "Pendiente de confirmar" as string | null,
    scheduledAt: null as string | null,
  };
  const otherThread = { messageKey: "m-otro", threadKey: "8", fromFan: false, body: "otra cosa", sentAt: later, priceCents: null };
  const fromFan = { messageKey: "m-fan", threadKey: "7", fromFan: true, body: "hola", sentAt: later, priceCents: null };
  assert.equal(reconcilePendingOutbound(draft, [otherThread, fromFan], now).action, "keep");
  const sent = reconcilePendingOutbound(draft, [
    otherThread,
    fromFan,
    { messageKey: "m-propio", threadKey: "7", fromFan: false, body: "hola", sentAt: "2026-11-06T12:00:05.000Z", priceCents: null },
  ], now);
  assert.deepEqual(sent, { action: "sent", messageKey: "m-propio" });
  const missed = reconcilePendingOutbound(draft, [
    { messageKey: "m-sigue", threadKey: "7", fromFan: false, body: "seguimos", sentAt: later, priceCents: null },
  ], now);
  assert.equal(missed.action, "missing");
  const early = reconcilePendingOutbound(draft, [
    { messageKey: "m-sigue", threadKey: "7", fromFan: false, body: "seguimos", sentAt: later, priceCents: null },
  ], Date.parse(created) + 30_000);
  assert.equal(early.action, "keep");
});

test("dos borradores con el mismo texto no comparten un mensaje", () => {
  const now = Date.parse("2026-11-06T14:00:00.000Z");
  const message = { messageKey: "m-1", threadKey: "7", fromFan: false, body: "hola", sentAt: "2026-11-06T12:10:00.000Z", priceCents: null };
  const failed = {
    id: "fail",
    authorId: "ana",
    body: "hola",
    priceCents: null,
    createdAt: "2026-11-06T12:00:00.000Z",
    threadKey: "7",
    fanKey: "7",
    ofMessageKey: null,
    errorReason: "Pendiente de confirmar" as string | null,
    scheduledAt: null as string | null,
  };
  const sent = {
    ...failed,
    id: "ok",
    authorId: "luis",
    createdAt: "2026-11-06T12:09:00.000Z",
    ofMessageKey: "m-1",
    errorReason: null,
  };
  const paired = reconcileOutboundBatch([failed, sent], [message], now);
  assert.deepEqual(paired.find((row) => row.id === "ok"), { id: "ok", action: "sent", messageKey: "m-1" });
  assert.notEqual(paired.find((row) => row.id === "fail")?.action, "sent");
  const closer = reconcileOutboundBatch([failed, { ...sent, ofMessageKey: null }], [message], now);
  const winners = closer.filter((row) => row.action === "sent");
  assert.equal(winners.length, 1);
  assert.equal(winners[0]?.id, "ok");
  const tie = reconcileOutboundBatch([
    failed,
    { ...sent, ofMessageKey: null, createdAt: "2026-11-06T12:00:20.000Z" },
  ], [{ ...message, sentAt: "2026-11-06T12:00:30.000Z" }], now);
  assert.equal(tie.some((row) => row.action === "sent"), false);
  const taken = reconcileOutboundBatch([failed], [message], now, new Set(["m-1"]));
  assert.notEqual(taken[0]?.action, "sent");
  const encoded = reconcileOutboundBatch(
    [{ ...failed, body: "hola & adios" }],
    [{ ...message, body: "Hola &amp; adios ❤\uFE0F", sentAt: "2026-11-06T12:00:05.000Z" }],
    now,
  );
  assert.equal(encoded[0]?.action, "keep");
  const same = reconcileOutboundBatch(
    [{ ...failed, body: "hola & adios ❤" }],
    [{ ...message, body: "Hola &amp; adios ❤\uFE0F", sentAt: "2026-11-06T12:00:05.000Z" }],
    now,
  );
  assert.deepEqual(same[0], { id: "fail", action: "sent", messageKey: "m-1" });
});

test("la columna de envío se consulta una sola vez por conexión", async () => {
  let calls = 0;
  const sql = {
    async query<T>(text: string): Promise<T[]> {
      if (text.includes("information_schema")) {
        calls += 1;
        return [{ column_name: "error_reason" }] as T[];
      }
      return [];
    },
  };
  assert.equal(await outboundSendStateReady(sql), true);
  assert.equal(await outboundSendStateReady(sql), true);
  assert.equal(calls, 1);
  let ready = false;
  let later = 0;
  const pending = {
    async query<T>(): Promise<T[]> {
      later += 1;
      return (ready ? [{ column_name: "error_reason" }] : []) as T[];
    },
  };
  assert.equal(await outboundSendStateReady(pending), false);
  assert.equal(await outboundSendStateReady(pending), false);
  ready = true;
  assert.equal(await outboundSendStateReady(pending), true);
  assert.equal(await outboundSendStateReady(pending), true);
  assert.equal(later, 3);
});

test("un envío visto sin id queda pendiente de confirmar", async () => {
  const db = new PGlite();
  for (const file of ["0007_of_reads.sql", "0008_sync_schedule.sql", "0009_of_chats.sql", "0013_chat_price.sql", "0018_chat_preview.sql", "0019_chat_author.sql", "0020_chat_card.sql", "0021_fan_profile.sql", "0022_message_media.sql", "0024_outbound_schedule.sql", "0025_outbound_send.sql"]) {
    await db.exec(await readFile(path.join(root, "migrations", file), "utf8"));
  }
  const sql: ReadSql = {
    async query<T>(text: string, params?: unknown[]): Promise<T[]> {
      const result = await db.query<T>(text, params);
      return result.rows;
    },
  };
  await db.exec("insert into staff_profile (user_id, display_name, role) values ('e-1', 'Ana', 'chatter')");
  await recordOutbound(sql, {
    id: "out-wait",
    createdAt: new Date().toISOString(),
    creatorId: "creator-1",
    fanKey: "fan-7",
    threadKey: "fan-7",
    authorId: "e-1",
    body: "hola",
    priceCents: null,
    ofMessageKey: null,
  });
  await markOutboundAwaiting(sql, "out-wait");
  const pending = await listPendingOutbounds(sql, ["creator-1"]);
  assert.equal(pending.length, 1);
  assert.equal(pending[0]?.status, "pending");
  assert.equal(pending[0]?.errorReason, "Pendiente de confirmar");
  const row = await sql.query<{ of_message_key: string | null; status: string }>(
    "select of_message_key, status from of_chat_outbound where id = $1",
    ["out-wait"],
  );
  assert.equal(row[0]?.of_message_key, null);
  assert.equal(row[0]?.status, "pending");
  await markOutboundSent(sql, "out-wait", "of-300");
  await markOutboundAwaiting(sql, "out-wait");
  const sent = await sql.query<{ of_message_key: string | null; status: string }>(
    "select of_message_key, status from of_chat_outbound where id = $1",
    ["out-wait"],
  );
  assert.equal(sent[0]?.status, "sent");
  assert.equal(sent[0]?.of_message_key, "of-300");
});

test("dos hola del mismo hilo no dejan enviado el que falló", async () => {
  const db = new PGlite();
  for (const file of ["0007_of_reads.sql", "0008_sync_schedule.sql", "0009_of_chats.sql", "0013_chat_price.sql", "0018_chat_preview.sql", "0019_chat_author.sql", "0020_chat_card.sql", "0021_fan_profile.sql", "0022_message_media.sql", "0024_outbound_schedule.sql", "0025_outbound_send.sql"]) {
    await db.exec(await readFile(path.join(root, "migrations", file), "utf8"));
  }
  const sql: ReadSql = {
    async query<T>(text: string, params?: unknown[]): Promise<T[]> {
      const result = await db.query<T>(text, params);
      return result.rows;
    },
  };
  await db.exec("insert into staff_profile (user_id, display_name, role) values ('ana', 'Ana', 'chatter'), ('luis', 'Luis', 'chatter')");
  await recordOutbound(sql, {
    id: "fail",
    createdAt: "2026-11-06T12:00:00.000Z",
    creatorId: "creator-1",
    fanKey: "7",
    threadKey: "7",
    authorId: "ana",
    body: "hola",
    priceCents: null,
    ofMessageKey: null,
  });
  await recordOutbound(sql, {
    id: "ok",
    createdAt: "2026-11-06T12:09:00.000Z",
    creatorId: "creator-1",
    fanKey: "7",
    threadKey: "7",
    authorId: "luis",
    body: "hola",
    priceCents: null,
    ofMessageKey: null,
  });
  await markOutboundAwaiting(sql, "fail");
  await markOutboundSent(sql, "ok", "m-1");
  await saveChatRead(sql, "creator-1", {
    reason: null,
    jsonPaths: [],
    threads: [],
    messages: [{
      messageKey: "m-1",
      threadKey: "7",
      fanKey: "7",
      body: "hola",
      sentAt: "2026-11-06T12:10:00.000Z",
      priceCents: null,
      purchased: null,
      seen: null,
      automatic: false,
      fromFan: false,
      fromUserId: "me",
    }],
  });
  const rows = await sql.query<{ id: string; status: string; matched_message_key: string | null; author_id: string }>(
    "select id, status, matched_message_key, author_id from of_chat_outbound order by id",
  );
  const failed = rows.find((row) => row.id === "fail");
  const gone = rows.find((row) => row.id === "ok");
  assert.equal(gone?.matched_message_key, "m-1");
  assert.equal(gone?.status, "sent");
  assert.equal(failed?.matched_message_key, null);
  assert.notEqual(failed?.status, "sent");
  const author = await sql.query<{ author_id: string | null }>(
    "select author_id from of_chat_message where message_key = $1",
    ["m-1"],
  );
  assert.equal(author[0]?.author_id, "luis");
  await db.close();
});
