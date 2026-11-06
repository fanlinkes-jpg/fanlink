import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import type { Page } from "playwright";
import { deliverDrafts, type DraftDelivery } from "../campaigns/deliver.ts";
import { deliverIfNoMedia, mediaSendGate } from "../send/media-gate.ts";
import { commitOutbound, recordOutbound } from "../sync/chat-store.ts";
import { prepareOutbound } from "../sync/composer-draft.ts";
import type { ReadSql } from "../sync/store.ts";
import { decideMediaAttach, recordOutboundMedia, saveVaultRead } from "../sync/vault-store.ts";
import type { VaultItem, VaultRead } from "../sync/vault.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

test("un id ajeno no se guarda, la cadena incompleta se bloquea y el envío de medios no sale", async () => {
  const db = new PGlite();
  const files = [
    "0007_of_reads.sql",
    "0008_sync_schedule.sql",
    "0009_of_chats.sql",
    "0013_chat_price.sql",
    "0019_chat_author.sql",
    "0020_chat_card.sql",
    "0028_message_media.sql",
    "0029_vault_media.sql",
    "0030_outbound_media.sql",
    "0031_outbound_media_owner.sql",
  ];
  for (const file of files) await db.exec(await readFile(path.join(root, "migrations", file), "utf8"));
  const seen: Array<{ text: string; params: unknown[] }> = [];
  const sql: ReadSql = {
    async query<T>(text: string, params?: unknown[]): Promise<T[]> {
      seen.push({ text, params: params ?? [] });
      const result = await db.query<T>(text, params);
      return result.rows;
    },
  };
  await saveVaultRead(sql, "c-1", vaultRead());
  await saveVaultRead(sql, "c-2", {
    ...vaultRead(),
    folders: [],
    items: [{ ...item("ajena", null), title: "de otra" }],
  });
  seen.length = 0;

  const own = await decideMediaAttach(sql, "c-1", ["v1"]);
  assert.equal(own.ok, true);
  if (!own.ok) return;
  assert.deepEqual(own.items, [{ id: "v1", title: "SECRETO INTERNO", couple: "SOLA", act: "anal" }]);
  const itemQueries = seen.filter((query) => query.text.includes("from of_vault_item"));
  assert.equal(itemQueries.length, 1);
  assert.equal(itemQueries.every((query) => query.text.includes("media_id in")), true);
  assert.deepEqual(itemQueries[0]?.params, ["c-1", "v1"]);
  assert.equal(seen.some((query) => query.text.includes("from of_vault_folder")), false);
  const leaked = prepareOutbound(`mira ${own.items[0]?.title} con ${own.items[0]?.couple} y ${own.items[0]?.act}`, own.items, null);
  assert.equal(leaked.ok, false);
  if (!leaked.ok) assert.equal(leaked.notice, "Quita el título del mensaje");
  const twice = await decideMediaAttach(sql, "c-1", ["v1", "v1"]);
  assert.equal(twice.ok, true);
  if (twice.ok) assert.equal(twice.items.length, 1);

  const missing = await decideMediaAttach(sql, "c-1", ["no-esta"]);
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.notice, "Sin datos");
  const foreign = await decideMediaAttach(sql, "c-1", ["ajena"]);
  assert.equal(foreign.ok, false);
  if (!foreign.ok) assert.equal(foreign.notice, "Sin datos");
  const broken = await decideMediaAttach(sql, "c-1", ["v-child"]);
  assert.equal(broken.ok, false);
  if (!broken.ok) assert.equal(broken.notice, "NO VENDER");
  const folderQueries = seen.filter((query) => query.text.includes("from of_vault_folder"));
  assert.equal(folderQueries.every((query) => query.text.includes("folder_id in")), true);
  assert.equal(folderQueries.some((query) => query.params.includes("otra")), false);
  const mixed = await decideMediaAttach(sql, "c-1", ["v1", "no-esta"]);
  assert.equal(mixed.ok, false);
  assert.equal(Number((await sql.query<{ n: number }>("select count(*)::int as n from of_outbound_media"))[0]?.n), 0);

  await db.exec("insert into staff_profile (user_id, display_name, role) values ('u1', 'Ana', 'owner')");
  await recordOutbound(sql, {
    id: "out-1",
    creatorId: "c-1",
    threadKey: "7",
    fanKey: "7",
    authorId: "u1",
    body: "mira con y",
    priceCents: 500,
    createdAt: "2026-11-06T12:00:00.000Z",
    ofMessageKey: null,
  });
  await recordOutboundMedia(sql, "out-1", "c-1", ["v1"]);
  const stored = await sql.query<{ creator_id: string }>("select creator_id from of_outbound_media where outbound_id = $1", ["out-1"]);
  assert.equal(stored[0]?.creator_id, "c-1");
  let opened = false;
  const blockedSend = await deliverIfNoMedia(sql, "out-1", async () => {
    opened = true;
  });
  assert.equal(blockedSend.sent, false);
  assert.equal(blockedSend.reason, "El envío de medios no existe");
  assert.equal(opened, false);
  await sql.query("delete from of_chat_outbound where id = $1", ["out-1"]);
  assert.equal(Number((await sql.query<{ n: number }>("select count(*)::int as n from of_outbound_media"))[0]?.n), 0);
  const clear = await deliverIfNoMedia(sql, "out-1", async () => {
    opened = true;
  });
  assert.equal(clear.sent, true);
  assert.equal(opened, true);
  await assert.rejects(sql.query(
    "insert into of_outbound_media (outbound_id, creator_id, media_id, position) values ($1, $2, $3, $4)",
    ["no-such", "c-1", "v1", 0],
  ));
  await db.close();
});

test("una 0030 ya aplicada gana creadora y clave foránea", async () => {
  const db = new PGlite();
  const files = [
    "0007_of_reads.sql",
    "0008_sync_schedule.sql",
    "0009_of_chats.sql",
    "0013_chat_price.sql",
    "0019_chat_author.sql",
    "0020_chat_card.sql",
  ];
  for (const file of files) await db.exec(await readFile(path.join(root, "migrations", file), "utf8"));
  await db.exec(`create table of_outbound_media (
    outbound_id text not null,
    media_id text not null,
    position integer not null,
    primary key (outbound_id, media_id)
  )`);
  await db.exec("insert into staff_profile (user_id, display_name, role) values ('u1', 'Ana', 'owner')");
  await db.exec("insert into of_chat_outbound (id, creator_id, author_id, body) values ('out-1', 'c-1', 'u1', 'hola')");
  await db.exec("insert into of_outbound_media (outbound_id, media_id, position) values ('out-1', 'v1', 0)");
  await db.exec("insert into of_outbound_media (outbound_id, media_id, position) values ('huerfana', 'v9', 0)");
  await db.exec(await readFile(path.join(root, "migrations", "0031_outbound_media_owner.sql"), "utf8"));
  const columns = await db.query<{ column_name: string }>(
    "select column_name from information_schema.columns where table_name = 'of_outbound_media'",
  );
  assert.equal(columns.rows.some((row) => row.column_name === "creator_id"), true);
  const kept = await db.query<{ creator_id: string }>("select creator_id from of_outbound_media where outbound_id = 'out-1'");
  assert.equal(kept.rows[0]?.creator_id, "c-1");
  assert.equal(Number((await db.query<{ n: number }>("select count(*)::int as n from of_outbound_media where outbound_id = 'huerfana'")).rows[0]?.n), 0);
  await assert.rejects(db.query(
    "insert into of_outbound_media (outbound_id, creator_id, media_id, position) values ('no-such', 'c-1', 'v1', 0)",
  ));
  await db.close();
});

test("un borrador con medios no se escribe en el formulario", async () => {
  assert.equal(mediaSendGate(1).allowed, false);
  assert.equal(mediaSendGate(0).allowed, true);
  const calls = { fill: 0, type: 0, press: 0 };
  const page = {
    fill() { calls.fill += 1; },
    type() { calls.type += 1; },
    press() { calls.press += 1; },
    goto() { throw new Error("abrió el envío"); },
    click() { throw new Error("pulsó el envío"); },
  } as unknown as Page;
  const blocked = await deliverDrafts(page, {
    flag: "true",
    hostname: "127.0.0.1",
    formUrl: "http://127.0.0.1/simulate-send",
    drafts: [{ fanKey: "7", body: "solo texto", priceCents: null, mediaCount: 1 }],
  });
  assert.equal(blocked.delivered, 0);
  assert.equal(blocked.reason, "El envío de medios no existe");
  assert.equal(calls.fill, 0);
  assert.equal(calls.type, 0);
  assert.equal(calls.press, 0);
  const omitted = await deliverDrafts(page, {
    flag: "true",
    hostname: "127.0.0.1",
    formUrl: "http://127.0.0.1/simulate-send",
    drafts: [{ fanKey: "7", body: "solo texto", priceCents: null } as DraftDelivery],
  });
  assert.equal(omitted.delivered, 0);
  assert.equal(calls.fill, 0);
});

test("send no escribe en el formulario sin la gate", async () => {
  const dir = path.join(root, "server/of-sessions/send");
  const files = (await readdir(dir)).filter((file) => file.endsWith(".ts"));
  assert.ok(files.length > 0);
  for (const file of files) {
    const source = await readFile(path.join(dir, file), "utf8");
    if (/\.(fill|type|press)\s*\(/.test(source)) {
      assert.match(source, /deliverIfNoMedia/);
    }
  }
});

test("el borrador y el medio se guardan juntos o no se guarda ninguno", async () => {
  const db = new PGlite();
  const files = [
    "0007_of_reads.sql",
    "0008_sync_schedule.sql",
    "0009_of_chats.sql",
    "0013_chat_price.sql",
    "0019_chat_author.sql",
    "0020_chat_card.sql",
    "0030_outbound_media.sql",
  ];
  for (const file of files) await db.exec(await readFile(path.join(root, "migrations", file), "utf8"));
  await db.exec("insert into staff_profile (user_id, display_name, role) values ('u1', 'Ana', 'owner')");
  const draft = {
    id: "out-1",
    creatorId: "c-1",
    threadKey: "7",
    fanKey: "7",
    authorId: "u1",
    body: "hola",
    priceCents: null as number | null,
    createdAt: "2026-11-06T12:00:00.000Z",
    ofMessageKey: null,
  };
  const failing = transactional(db, true);
  await assert.rejects(commitOutbound(failing, draft, ["v1"]));
  assert.equal(Number((await db.query<{ n: number }>("select count(*)::int as n from of_chat_outbound")).rows[0]?.n), 0);
  assert.equal(Number((await db.query<{ n: number }>("select count(*)::int as n from of_outbound_media")).rows[0]?.n), 0);
  await commitOutbound(transactional(db, false), draft, ["v1"]);
  assert.equal(Number((await db.query<{ n: number }>("select count(*)::int as n from of_chat_outbound")).rows[0]?.n), 1);
  const kept = await db.query<{ creator_id: string }>("select creator_id from of_outbound_media where outbound_id = 'out-1'");
  assert.equal(kept.rows[0]?.creator_id, "c-1");
  await db.close();
});

function transactional(db: PGlite, failMedia: boolean): ReadSql & { transaction<T>(run: (tx: ReadSql) => Promise<T>): Promise<T> } {
  return {
    async query() {
      throw new Error("fuera de la transacción");
    },
    async transaction(run) {
      await db.exec("BEGIN");
      const tx: ReadSql = {
        async query<T>(text: string, params?: unknown[]): Promise<T[]> {
          if (failMedia && text.includes("insert into of_outbound_media")) throw new Error("media");
          const result = await db.query<T>(text, params);
          return result.rows;
        },
      };
      try {
        const result = await run(tx);
        await db.exec("COMMIT");
        return result;
      } catch (error) {
        await db.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

test("la playlist y el trozo de chat-media llevan nosniff", async () => {
  const source = await readFile(path.join(root, "src/routes/api/chat-media.ts"), "utf8");
  const hits = source.match(/x-content-type-options": "nosniff"/g) ?? [];
  assert.equal(hits.length, 2);
});

function vaultRead(): VaultRead {
  return {
    notice: null,
    done: true,
    cursor: null,
    folders: [
      { id: "child", name: "tarde", parentId: "gone" },
      { id: "otra", name: "mañana", parentId: null },
    ],
    items: [
      item("v1", null),
      { ...item("v-child", "child"), title: "tarde", couple: null, act: null },
    ],
  };
}

function item(id: string, folderId: string | null): VaultItem {
  return {
    id,
    title: "SECRETO INTERNO",
    kind: "video",
    seconds: 90,
    preview: null,
    full: null,
    createdAt: "2026-11-06T12:00:00.000Z",
    folderId,
    tags: [],
    priceCents: null,
    sales: null,
    trailer: false,
    couple: "SOLA",
    act: "anal",
    blocked: null,
  };
}
