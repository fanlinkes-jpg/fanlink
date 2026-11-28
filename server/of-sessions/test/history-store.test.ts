import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { historyCandidates, nextHistoryThread } from "../sync/history.ts";
import { ensureHistoryThread, listOpenHistory, markHistory } from "../sync/chat-store.ts";
import type { ReadSql } from "../sync/store.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

test("un hilo huérfano recibe history_done y el bucle avanza", async () => {
  const db = await database();
  try {
    await db.sql.query(
      `insert into of_chat_message (
         creator_id, message_key, thread_key, fan_key, from_fan, body, sent_at, price_cents, purchased, synced_at, origin
       ) values ($1, $2, $3, $4, false, $5, $6, 1999, true, $6, 'onlyfans')`,
      ["jose", "9001", "591849192", "591849192", "Compra guardada", "2026-11-02T00:00:00.000Z"],
    );
    const before = await listOpenHistory(db.sql, "jose");
    assert.equal(before.some((row) => row.threadKey === "591849192"), true);
    await ensureHistoryThread(db.sql, "jose", "591849192");
    await markHistory(db.sql, "jose", "591849192", "9001", true);
    const open = historyCandidates(await listOpenHistory(db.sql, "jose"));
    assert.equal(open.find((row) => row.threadKey === "591849192"), undefined);
    await db.sql.query(
      `insert into of_chat_thread (creator_id, thread_key, fan_key, synced_at, origin, history_done)
       values ('jose', '387943185', '387943185', now(), 'onlyfans', false)`,
    );
    const waiting = historyCandidates(await listOpenHistory(db.sql, "jose"));
    assert.equal(nextHistoryThread(waiting)?.threadKey, "387943185");
  } finally {
    await db.pg.close();
  }
});

async function database(): Promise<{ pg: PGlite; sql: ReadSql }> {
  const pg = new PGlite();
  const dir = path.join(root, "migrations");
  const files = (await readdir(dir)).filter((name) => name.endsWith(".sql")).sort();
  for (const file of files) {
    await pg.exec(await readFile(path.join(dir, file), "utf8"));
  }
  const sql: ReadSql = {
    query: async (text, params) => {
      const result = await pg.query(text, params);
      return result.rows as never;
    },
  };
  return { pg, sql };
}