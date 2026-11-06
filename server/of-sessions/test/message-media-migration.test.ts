import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

test("la 0028 pasa dos veces y también si la 0022 ya creó las columnas", async () => {
  const db = new PGlite();
  const files = ["0007_of_reads.sql", "0008_sync_schedule.sql", "0009_of_chats.sql", "0013_chat_price.sql", "0018_chat_preview.sql", "0019_chat_author.sql", "0020_chat_card.sql"];
  for (const file of files) await db.exec(await readFile(path.join(root, "migrations", file), "utf8"));
  await db.exec(`
    alter table of_chat_message add column media_count integer;
    alter table of_chat_message add column media_seconds integer;
    alter table of_chat_message add column media_preview text;
  `);
  const migration = await readFile(path.join(root, "migrations", "0028_message_media.sql"), "utf8");
  await db.exec(migration);
  await db.exec(migration);
  const columns = await db.query<{ column_name: string; data_type: string }>(
    `select column_name, data_type
     from information_schema.columns
     where table_name = 'of_chat_message'
       and column_name in ('media_count', 'media_seconds', 'media_preview', 'media_json')
     order by column_name`,
  );
  const type = new Map(columns.rows.map((row) => [row.column_name, row.data_type]));
  assert.equal(type.get("media_count"), "integer");
  assert.equal(type.get("media_seconds"), "integer");
  assert.equal(type.get("media_preview"), "text");
  assert.equal(type.get("media_json"), "text");
  await db.close();
});
