import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { listVault, saveVaultRead, vaultCursor } from "../sync/vault-store.ts";
import { vaultForBrowser, type VaultRead } from "../sync/vault.ts";
import type { ReadSql } from "../sync/store.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

test("la bóveda guarda la URL en el servidor y no la devuelve al navegador", async () => {
  const db = new PGlite();
  await db.exec(await readFile(path.join(root, "migrations", "0022_vault_media.sql"), "utf8"));
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
