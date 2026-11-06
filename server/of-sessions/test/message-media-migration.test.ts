import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const sql0028 = `
alter table of_chat_message add column if not exists media_count integer;
alter table of_chat_message add column if not exists media_seconds integer;
alter table of_chat_message add column if not exists media_preview text;
alter table of_chat_message add column if not exists media_json text;
`;

test("la 0022 y la 0028 dejan las mismas columnas en cualquier orden", async () => {
  const sql0022 = await readFile(path.join(root, "migrations", "0022_message_media.sql"), "utf8");
  const first = await columns(sql0022, sql0028);
  const second = await columns(sql0028, sql0022);
  assert.deepEqual(first, second);
  assert.deepEqual(first, [
    { column_name: "media_count", data_type: "integer" },
    { column_name: "media_json", data_type: "text" },
    { column_name: "media_preview", data_type: "text" },
    { column_name: "media_seconds", data_type: "integer" },
  ]);
});

async function columns(first: string, second: string): Promise<Array<{ column_name: string; data_type: string }>> {
  const db = new PGlite();
  await db.exec("create table of_chat_message (creator_id text)");
  await db.exec(first);
  await db.exec(second);
  const result = await db.query<{ column_name: string; data_type: string }>(
    `select column_name, data_type from information_schema.columns
     where table_name = 'of_chat_message' and column_name like 'media_%'
     order by column_name`,
  );
  await db.close();
  return result.rows;
}
