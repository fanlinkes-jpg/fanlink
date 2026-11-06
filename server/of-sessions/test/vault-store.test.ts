import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { encodeMedia } from "../sync/history.ts";
import { listVault, saveVaultRead, sendsForFan, vaultCursor } from "../sync/vault-store.ts";
import { vaultForBrowser, type VaultRead } from "../sync/vault.ts";
import type { ReadSql } from "../sync/store.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

test("la bóveda guarda la URL en el servidor y no la devuelve al navegador", async () => {
  const db = new PGlite();
  await db.exec(await readFile(path.join(root, "migrations", "0029_vault_media.sql"), "utf8"));
  const sql: ReadSql = {
    async query<T>(text: string, params?: unknown[]): Promise<T[]> {
      const result = await db.query<T>(text, params);
      return result.rows;
    },
  };
  const read: VaultRead = {
    notice: null,
    done: false,
    cursor: "20",
    folders: [{ id: "sola", name: "SOLA", parentId: null }],
    items: [{
      id: "v1",
      title: "tarde",
      kind: "video",
      seconds: 90,
      preview: "https://cdn2.onlyfans.com/t.jpg",
      full: "https://cdn2.onlyfans.com/privado.mp4",
      createdAt: "2026-11-06T12:00:00.000Z",
      folderId: "sola",
      tags: ["sent"],
      priceCents: null,
      sales: null,
      trailer: false,
      couple: "SOLA",
      act: null,
      blocked: "SIN EDITAR",
    }],
  };
  await saveVaultRead(sql, "c-1", read);
  const stored = await listVault(sql, "c-1");
  assert.equal(stored.items[0]?.full, "https://cdn2.onlyfans.com/privado.mp4");
  assert.equal(stored.items[0]?.blocked, "SIN EDITAR");
  assert.equal(vaultForBrowser(stored.items[0]!).hasPreview, true);
  assert.equal("full" in vaultForBrowser(stored.items[0]!), false);
  assert.equal(await vaultCursor(sql, "c-1"), "20");
  await db.close();
});

test("el historial por fan sale de la base y casa el id del medio", async () => {
  const db = new PGlite();
  const files = ["0007_of_reads.sql", "0008_sync_schedule.sql", "0009_of_chats.sql", "0013_chat_price.sql", "0019_chat_author.sql", "0020_chat_card.sql", "0028_message_media.sql"];
  for (const file of files) await db.exec(await readFile(path.join(root, "migrations", file), "utf8"));
  for (const file of files) await db.exec(await readFile(path.join(root, "migrations", "0028_message_media.sql"), "utf8"));
  const sql: ReadSql = {
    async query<T>(text: string, params?: unknown[]): Promise<T[]> {
      const result = await db.query<T>(text, params);
      return result.rows;
    },
  };
  const media = encodeMedia([{
    kind: "video",
    seconds: 10,
    preview: null,
    full: "https://cdn2.onlyfans.com/v.mp4",
    locked: false,
    priceCents: 1500,
    paid: true,
    opened: true,
    vaultId: "99",
  }]);
  await db.query(
    `insert into of_chat_message (
       creator_id, message_key, thread_key, fan_key, from_fan, body, sent_at, price_cents, purchased, synced_at, origin, media_json
     ) values ('c-1', 'm1', '7', '7', false, 'hola', '2026-11-06T12:00:00Z', 1500, true, now(), 'onlyfans', $1)`,
    [media],
  );
  const sends = await sendsForFan(sql, "c-1", "7");
  assert.equal(sends[0]?.mediaId, "99");
  assert.equal(sends[0]?.purchased, true);
  assert.equal(sends[0]?.priceCents, 1500);
  assert.deepEqual(await sendsForFan(sql, "c-1", "otro"), []);
  await db.close();
});
