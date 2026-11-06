import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { draftAfterKey } from "../live/desk.ts";
import { attributeLiveSend } from "../sync/chat-store.ts";
import type { ReadSql } from "../sync/store.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

test("el tecleo del borrador atribuye el mensaje al chatter", async () => {
  const db = new PGlite();
  const dir = path.join(root, "migrations");
  const files = (await readdir(dir)).filter((name) => name.endsWith(".sql")).sort();
  for (const file of files) await db.exec(await readFile(path.join(dir, file), "utf8"));
  await db.exec(`
    insert into staff_profile (user_id, display_name, role, perms) values
      ('ana', 'Ana', 'member', '[]'::jsonb);
    insert into of_chat_message (
      creator_id, message_key, thread_key, fan_key, from_fan, body, sent_at, synced_at
    ) values (
      'c1', 'm-live', '7', '7', false, 'hola', '2026-11-06T12:00:05.000Z', '2026-11-06T12:00:06.000Z'
    );
  `);
  const sql: ReadSql = {
    async query<T>(text: string, params?: unknown[]): Promise<T[]> {
      const result = await db.query<T>(text, params);
      return result.rows;
    },
  };
  let draft = "";
  for (const key of ["h", "o", "l", "a"]) draft = draftAfterKey(draft, key, true);
  draft = draftAfterKey(draft, "Backspace", true);
  draft = draftAfterKey(draft, "a", true);
  const gestureAt = "2026-11-06T12:00:04.000Z";
  const input = {
    id: "out-live",
    creatorId: "c1",
    threadKey: "7",
    fanKey: "7",
    authorId: "ana",
    body: "hola",
    priceCents: null,
    messageId: "m-live",
    createdAt: gestureAt,
    sentAt: "2026-11-06T12:00:05.000Z",
    controlSince: "2026-11-06T12:00:00.000Z",
    gestureAt,
    observedAt: "2026-11-06T12:00:06.000Z",
  };
  assert.equal(await attributeLiveSend(sql, { ...input, draftBody: "adios" }), false);
  const untouched = await sql.query<{ author_id: string | null }>(
    "select author_id from of_chat_message where message_key = 'm-live'",
  );
  assert.equal(untouched[0]?.author_id, null);
  assert.equal(await attributeLiveSend(sql, { ...input, draftBody: draft }), true);
  const author = await sql.query<{ author_id: string | null }>(
    "select author_id from of_chat_message where message_key = 'm-live'",
  );
  assert.equal(author[0]?.author_id, "ana");
  const outbound = await sql.query<{ author_id: string; matched_message_key: string | null }>(
    "select author_id, matched_message_key from of_chat_outbound where id = 'out-live'",
  );
  assert.equal(outbound[0]?.author_id, "ana");
  assert.equal(outbound[0]?.matched_message_key, "m-live");
  await db.close();
});
