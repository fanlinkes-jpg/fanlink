import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { listPendingOutbounds, markOutboundAwaiting, markOutboundSent, outboundSendStateReady, reconcilePendingOutbound, recordOutbound } from "../sync/chat-store.ts";
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
