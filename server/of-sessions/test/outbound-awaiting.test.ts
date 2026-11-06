import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { listPendingOutbounds, markOutboundAwaiting, markOutboundSent, outboundStillMissing, recordOutbound } from "../sync/chat-store.ts";
import type { ReadSql } from "../sync/store.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

test("sin el mensaje en la sincronización posterior queda como no enviado", () => {
  const created = "2026-11-06T12:00:00.000Z";
  const draft = { createdAt: created, errorReason: "Pendiente de confirmar", scheduledAt: null };
  assert.equal(outboundStillMissing(draft, [{ sentAt: "2026-11-06T11:00:00.000Z" }]), false);
  assert.equal(outboundStillMissing(draft, [{ sentAt: "2026-11-06T12:00:05.000Z" }]), true);
  assert.equal(outboundStillMissing({ ...draft, errorReason: null }, [{ sentAt: "2026-11-06T12:00:05.000Z" }]), false);
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
