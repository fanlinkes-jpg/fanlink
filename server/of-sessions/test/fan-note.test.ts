import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { listFanNotes, saveFanNote } from "../sync/fan-note.ts";
import type { ReadSql } from "../sync/store.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

test("la nota de la creadora se guarda para el equipo con autor y hora", async () => {
  const db = new PGlite();
  await db.exec(`
    create table staff_profile (
      user_id text primary key,
      display_name text not null,
      role text not null,
      perms jsonb not null default '[]'::jsonb,
      created_at timestamptz not null default now()
    );
  `);
  await db.exec(await readFile(path.join(root, "migrations", "0023_fan_note.sql"), "utf8"));
  const sql: ReadSql = {
    async query<T>(text: string, params?: unknown[]): Promise<T[]> {
      const result = await db.query<T>(text, params);
      return result.rows;
    },
  };
  await db.exec("insert into staff_profile (user_id, display_name, role) values ('e-1', 'Ana', 'chatter')");
  await saveFanNote(sql, { creatorId: "c-1", fanKey: "fan-7", body: "le gusta el azul", updatedBy: "e-1" });
  const [note] = await listFanNotes(sql, ["c-1"]);
  assert.equal(note?.body, "le gusta el azul");
  assert.equal(note?.authorName, "Ana");
  assert.ok(note?.updatedAt);
  await saveFanNote(sql, { creatorId: "c-1", fanKey: "fan-7", body: "cambió", updatedBy: "e-1" });
  const again = await listFanNotes(sql, ["c-1"]);
  assert.equal(again.length, 1);
  assert.equal(again[0]?.body, "cambió");
  await db.close();
});
