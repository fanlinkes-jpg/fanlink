import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { DIGEST_BODY_CHARS, OPEN_THREAD_MESSAGES, listChats } from "../sync/chat-store.ts";
import type { ReadSql } from "../sync/store.ts";

const SCHEMA = ["0007_of_reads.sql", "0008_sync_schedule.sql", "0009_of_chats.sql", "0013_chat_price.sql", "0018_chat_preview.sql", "0019_chat_author.sql", "0020_chat_card.sql", "0021_fan_profile.sql", "0022_message_media.sql", "0024_outbound_schedule.sql", "0025_outbound_send.sql", "0026_chat_history.sql", "0045_chat_unread_null.sql"];
const THREADS = 200;
const PER_THREAD = 120;

// Lista de 200 hilos con 120 mensajes cada uno, con medios pesados y textos largos.
async function bigDb(): Promise<{ sql: ReadSql; close: () => Promise<void> }> {
  const pg = new PGlite();
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../migrations");
  for (const name of SCHEMA) await pg.exec(await readFile(path.join(dir, name), "utf8"));
  await pg.exec(`
    insert into of_chat_thread (creator_id, thread_key, fan_key, fan_name, last_message_at, synced_at)
    select 'u1fpdnp', 't' || n, 't' || n, 'Fan ' || n, now() - (n || ' minutes')::interval, now() from generate_series(1, ${THREADS}) n;
    insert into of_chat_message (creator_id, message_key, thread_key, fan_key, from_fan, body, sent_at, price_cents, synced_at, media_count, media_json, event_kind, event_cents)
    select 'u1fpdnp', 'm' || t || '_' || k, 't' || t, 't' || t, (k % 2 = 0), repeat('texto largo ', 400),
           now() - ((t * 1000 + (${PER_THREAD} - k)) || ' seconds')::interval, null, now(), 3,
           '[' || repeat('{"kind":"foto","preview":"https://cdn.example/' || repeat('p', 300) || '"},', 3) || '{"kind":"foto"}]',
           case when k % 40 = 1 then 'propina' else null end, case when k % 40 = 1 then 500 else null end
    from generate_series(1, ${THREADS}) t, generate_series(1, ${PER_THREAD}) k;
  `);
  return {
    sql: { async query<T>(text: string, params?: unknown[]): Promise<T[]> { return (await pg.query<T>(text, params)).rows; } },
    close: () => pg.close(),
  };
}

test("la lista de chats queda acotada con 200 hilos y 120 mensajes por hilo", { timeout: 120_000 }, async () => {
  const db = await bigDb();
  try {
    const full = await listChats(db.sql, ["u1fpdnp"], { messages: "full" });
    const digest = await listChats(db.sql, ["u1fpdnp"], { messages: "digest", open: { creatorId: "u1fpdnp", threadKey: "t7" } });
    const none = await listChats(db.sql, ["u1fpdnp"], { messages: "none" });
    const fullBytes = JSON.stringify(full).length;
    const digestBytes = JSON.stringify(digest).length;
    assert.equal(digest.threads.length, THREADS);
    assert.equal(none.messages.length, 0);
    // Un hilo no abierto: último, último propio y hasta 2 de propina. Nunca más de 4.
    const perThread = new Map<string, number>();
    for (const message of digest.messages) perThread.set(message.threadKey, (perThread.get(message.threadKey) ?? 0) + 1);
    for (const [threadKey, count] of perThread) {
      if (threadKey !== "t7") assert.ok(count <= 4, `${threadKey} trae ${count}`);
    }
    // El abierto va con sus mensajes recientes y sus medios.
    const open = digest.messages.filter((message) => message.threadKey === "t7");
    assert.ok(open.length >= OPEN_THREAD_MESSAGES && open.length <= OPEN_THREAD_MESSAGES + 3, `abierto ${open.length}`);
    assert.ok(open.some((message) => (message.media?.length ?? 0) > 0));
    // El resto, sin medios y con el texto recortado.
    const others = digest.messages.filter((message) => message.threadKey !== "t7");
    assert.ok(others.length <= THREADS * 4);
    assert.ok(others.every((message) => message.media == null || message.media.length === 0));
    assert.ok(others.every((message) => message.body.length <= DIGEST_BODY_CHARS));
    // Cada hilo conserva su último mensaje y las propinas siguen visibles.
    assert.ok(digest.messages.some((message) => message.eventKind === "propina"));
    // Tamaño: muy por debajo del límite de 32 MB y mucho menor que la lectura completa.
    assert.ok(digestBytes < 1_500_000, `digest ${digestBytes} bytes`);
    assert.ok(fullBytes > digestBytes * 5, `full ${fullBytes} vs digest ${digestBytes}`);
    // JSON plano: sin Date, Map ni Promise. Lo que sale de la base vuelve igual tras ida y vuelta.
    assert.deepEqual(JSON.parse(JSON.stringify(digest)), digest);
  } finally {
    await db.close();
  }
});
