import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { applyFlagOverrides, flagKey, listFanFlags, patchedFlag, saveFanFlag } from "../sync/fan-flags.ts";
import { inboxByRecent } from "../../../src/lib/inbox-selection.ts";
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

test("los chats fijados van arriba, el último fijado primero, y el resto sigue por mensaje reciente", () => {
  const rows = [
    { id: "a", lastMessageAt: "2026-11-05T10:00:00Z" },
    { id: "b", lastMessageAt: "2026-11-01T10:00:00Z" },
    { id: "c", lastMessageAt: "2026-11-03T10:00:00Z" },
    { id: "d", lastMessageAt: "2026-11-04T10:00:00Z" },
    { id: "e", lastMessageAt: null },
  ];
  const pins: Record<string, string> = { b: "2026-11-27T10:00:00Z", c: "2026-11-26T10:00:00Z" };
  const order = (list: typeof rows) => inboxByRecent(list, (row) => pins[row.id] ?? null).map((row) => row.id);
  assert.deepEqual(order(rows), ["b", "c", "a", "d", "e"]);
  // Al llegar un mensaje nuevo a un chat no fijado, los fijados siguen arriba y en el mismo orden.
  assert.deepEqual(order(rows.map((row) => (row.id === "e" ? { ...row, lastMessageAt: "2026-11-28T08:00:00Z" } : row))), ["b", "c", "e", "a", "d"]);
  // Sin fijados, o sin función, el orden es el de siempre.
  assert.deepEqual(inboxByRecent(rows).map((row) => row.id), ["a", "d", "c", "b", "e"]);
  assert.deepEqual(inboxByRecent(rows, () => null).map((row) => row.id), ["a", "d", "c", "b", "e"]);
});

test("al pulsar fijar o favorito la marca cambia al instante y un refresco viejo no la deshace", () => {
  const target = { creatorId: "c", fanKey: "f" };
  const now = "2026-11-28T09:00:00.000Z";
  const pinned = patchedFlag(null, target, { pinned: true }, now);
  assert.equal(pinned.pinnedAt, now);
  assert.equal(pinned.favorite, false);
  const both = patchedFlag(pinned, target, { favorite: true }, "2026-11-28T09:05:00.000Z");
  assert.equal(both.pinnedAt, now, "fijar otra marca no mueve la hora del pin");
  assert.equal(both.favorite, true);
  assert.equal(patchedFlag(both, target, { pinned: false }, now).pinnedAt, null);
  const overrides = { [flagKey(target)]: pinned };
  // El servidor aún manda la lista vieja sin el pin: se ve fijado igualmente.
  assert.deepEqual(applyFlagOverrides([], overrides).map((flag) => flag.pinnedAt), [now]);
  // Un desfijado pendiente quita la marca aunque el servidor todavía la traiga.
  const unpinned = patchedFlag(pinned, target, { pinned: false }, now);
  assert.deepEqual(applyFlagOverrides([pinned], { [flagKey(target)]: unpinned }), []);
  // Otras marcas no se tocan.
  const other = { creatorId: "c", fanKey: "g", favorite: true, muted: false, pinnedAt: null };
  assert.deepEqual(applyFlagOverrides([other], overrides).length, 2);
  assert.deepEqual(applyFlagOverrides([other], {}), [other]);
});
