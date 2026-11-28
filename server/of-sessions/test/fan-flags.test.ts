import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { listFanFlags, pinnedFirst, saveFanFlag } from "../sync/fan-flags.ts";
import type { ReadSql } from "../sync/store.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

async function open() {
  const db = new PGlite();
  await db.exec(await readFile(path.join(root, "migrations", "0062_fan_flags.sql"), "utf8"));
  const sql: ReadSql = {
    async query<T>(text: string, params?: unknown[]): Promise<T[]> {
      return (await db.query<T>(text, params)).rows;
    },
  };
  return { db, sql };
}

test("favorito, avisos y fijado se guardan por fan y cada cambio respeta lo demás", async () => {
  const { db, sql } = await open();
  await saveFanFlag(sql, { creatorId: "c-1", fanKey: "f-1", patch: { favorite: true }, updatedBy: "u-1" });
  await saveFanFlag(sql, { creatorId: "c-1", fanKey: "f-1", patch: { pinned: true }, updatedBy: "u-2" });
  let [flag] = await listFanFlags(sql, ["c-1"]);
  assert.equal(flag?.favorite, true);
  assert.equal(flag?.muted, false);
  assert.ok(flag?.pinnedAt);
  const pinnedAt = flag?.pinnedAt;
  await saveFanFlag(sql, { creatorId: "c-1", fanKey: "f-1", patch: { muted: true, pinned: true }, updatedBy: "u-2" });
  [flag] = await listFanFlags(sql, ["c-1"]);
  assert.equal(flag?.muted, true);
  assert.equal(flag?.favorite, true);
  assert.equal(flag?.pinnedAt, pinnedAt, "volver a fijar no cambia la hora");
  await saveFanFlag(sql, { creatorId: "c-1", fanKey: "f-1", patch: { pinned: false, favorite: false, muted: false }, updatedBy: "u-1" });
  assert.deepEqual(await listFanFlags(sql, ["c-1"]), []);
  await db.close();
});

test("las marcas no se mezclan entre cuentas ni entre fans", async () => {
  const { db, sql } = await open();
  await saveFanFlag(sql, { creatorId: "c-1", fanKey: "f-1", patch: { favorite: true }, updatedBy: "u" });
  await saveFanFlag(sql, { creatorId: "c-2", fanKey: "f-1", patch: { muted: true }, updatedBy: "u" });
  const one = await listFanFlags(sql, ["c-1"]);
  assert.equal(one.length, 1);
  assert.equal(one[0]?.favorite, true);
  assert.equal(one[0]?.muted, false);
  assert.equal((await listFanFlags(sql, ["c-1", "c-2"])).length, 2);
  assert.deepEqual(await listFanFlags(sql, []), []);
  await db.close();
});

test("sin la tabla la lista de chats sigue funcionando", async () => {
  const db = new PGlite();
  const sql: ReadSql = { async query<T>(text: string, params?: unknown[]) { return (await db.query<T>(text, params)).rows; } };
  assert.deepEqual(await listFanFlags(sql, ["c-1"]), []);
  await db.close();
});

test("los chats fijados van arriba, el último fijado primero, y el resto no cambia de orden", () => {
  const rows = [
    { creatorId: "c", fanKey: "a" },
    { creatorId: "c", fanKey: "b" },
    { creatorId: "c", fanKey: "c" },
    { creatorId: "c", fanKey: null },
    { creatorId: "d", fanKey: "b" },
  ];
  const flags = [
    { creatorId: "c", fanKey: "c", favorite: false, muted: false, pinnedAt: "2026-11-01T10:00:00.000Z" },
    { creatorId: "c", fanKey: "b", favorite: false, muted: false, pinnedAt: "2026-11-02T10:00:00.000Z" },
    { creatorId: "c", fanKey: "a", favorite: true, muted: false, pinnedAt: null },
  ];
  assert.deepEqual(pinnedFirst(rows, flags).map((row) => `${row.creatorId}${row.fanKey}`), ["cb", "cc", "ca", "cnull", "db"]);
  assert.deepEqual(pinnedFirst(rows, []), rows);
});
