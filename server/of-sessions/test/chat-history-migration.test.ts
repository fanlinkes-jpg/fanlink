import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const file = "0026_chat_history.sql";

test("la 0026 se puede aplicar dos veces", async () => {
  const db = new PGlite();
  const dir = path.join(root, "migrations");
  const files = (await readdir(dir)).filter((name) => name.endsWith(".sql")).sort();
  for (const name of files) {
    if (name >= file) break;
    await db.exec(await readFile(path.join(dir, name), "utf8"));
  }
  const sql = await readFile(path.join(dir, file), "utf8");
  await db.exec(sql);
  await db.exec(sql);
  const columns = await db.query<{ table_name: string; column_name: string }>(
    `select table_name, column_name
     from information_schema.columns
     where (table_name = 'of_chat_thread' and column_name in ('history_cursor', 'history_done'))
        or (table_name = 'of_sync_state' and column_name in ('chat_list_cursor', 'chat_list_done'))
     order by table_name, column_name`,
  );
  assert.deepEqual(columns.rows.map((row) => `${row.table_name}.${row.column_name}`), [
    "of_chat_thread.history_cursor",
    "of_chat_thread.history_done",
    "of_sync_state.chat_list_cursor",
    "of_sync_state.chat_list_done",
  ]);
  await db.close();
});
