import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { deliverChatSend } from "../send/deliver.ts";
import { handleChatMedia, handleVaultMedia, handleVaultQuery, handleVaultSend, mediaLogLine } from "../http/vault-http.ts";
import { presentGap, vaultCardHasMoney } from "../sync/vault-query.ts";
import { itemSaleBlocked } from "../sync/vault-block.ts";
import { suggestVaultPrice } from "../sync/vault-model.ts";
import { saveVaultMirror } from "../sync/vault-store.ts";
import type { ReadSql } from "../sync/store.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const NEW_FILES = ["0037_vault_mirror.sql", "0038_vault_fan_filter.sql", "0039_outbound_media.sql"];

const OLD_0028 = `
alter table of_chat_message add column if not exists media_count integer;
alter table of_chat_message add column if not exists media_seconds integer;
alter table of_chat_message add column if not exists media_preview text;
alter table of_chat_message add column if not exists media_json text;
`;

const OLD_0029 = `
create table if not exists of_vault_folder (
  creator_id text not null,
  folder_id text not null,
  name text not null,
  parent_id text,
  primary key (creator_id, folder_id)
);
create table if not exists of_vault_item (
  creator_id text not null,
  media_id text not null,
  title text,
  kind text,
  seconds integer,
  preview text,
  full_url text,
  created_at timestamptz,
  folder_id text,
  tags text,
  price_cents integer,
  sales integer,
  trailer boolean,
  couple text,
  act text,
  blocked text,
  synced_at timestamptz not null,
  primary key (creator_id, media_id)
);
create table if not exists of_vault_cursor (
  creator_id text primary key,
  cursor_text text,
  done boolean not null default false
);
`;

const OLD_0030 = `
create table if not exists of_outbound_media (
  outbound_id text not null references of_chat_outbound (id) on delete cascade,
  creator_id text not null,
  media_id text not null,
  position integer not null,
  primary key (outbound_id, media_id)
);
`;

const OLD_0031 = `
alter table of_outbound_media add column if not exists creator_id text;
update of_outbound_media as media
set creator_id = outbound.creator_id
from of_chat_outbound as outbound
where media.outbound_id = outbound.id
  and (media.creator_id is null or media.creator_id = '');
`;

test("las migraciones 0037+ no tienen DROP ni DELETE y se aplican dos veces", async () => {
  const db = new PGlite();
  try {
    for (const file of NEW_FILES) {
      const sql = await readFile(path.join(root, "migrations", file), "utf8");
      assert.equal(/\bdrop\b/i.test(sql), false, file);
      assert.equal(/\bdelete\b/i.test(sql), false, file);
    }
    await applyNew(db);
    await db.exec(`insert into of_vault_item (creator_id, item_key, title, sales_count) values ('c-1', 'm1', 'clip', null)`);
    await db.exec(`insert into of_vault_list (creator_id, list_key, name) values ('c-1', 'f1', 'playa')`);
    await db.exec(`insert into of_vault_fan_send (id, creator_id, fan_key, item_key) values ('s1', 'c-1', '7', 'm1')`);
    await db.exec(`insert into of_vault_filter (user_id, query) values ('u1', '{"text":"playa"}'::jsonb)`);
    await db.exec(`insert into of_outbound_media (outbound_id, creator_id, media_id, position) values ('out-1', 'c-1', 'm1', 0)`);
    await applyNew(db);
    assert.equal(await count(db, "of_vault_item"), 1);
    assert.equal(await count(db, "of_vault_list"), 1);
    assert.equal(await count(db, "of_vault_fan_send"), 1);
    assert.equal(await count(db, "of_vault_filter"), 1);
    assert.equal(await count(db, "of_outbound_media"), 1);
    const title = await db.query<{ title: string }>("select title from of_vault_item where item_key = 'm1'");
    assert.equal(title.rows[0]?.title, "clip");
  } finally {
    await db.close();
  }
});

test("la 0037+ funciona encima de las 0028–0031 antiguas y no borra esas filas", async () => {
  const db = new PGlite();
  try {
    for (const file of ["0007_of_reads.sql", "0008_sync_schedule.sql", "0009_of_chats.sql", "0013_chat_price.sql", "0019_chat_author.sql"]) {
      await db.exec(await readFile(path.join(root, "migrations", file), "utf8"));
    }
    await db.exec(OLD_0028);
    await db.exec(OLD_0029);
    await db.exec(OLD_0030);
    await db.exec(OLD_0031);
    await db.exec("insert into staff_profile (user_id, display_name, role) values ('u1', 'Ana', 'owner')");
    await db.exec("insert into of_chat_outbound (id, creator_id, author_id, body) values ('out-1', 'c-1', 'u1', 'hola')");
    await db.exec("insert into of_outbound_media (outbound_id, creator_id, media_id, position) values ('out-1', 'c-1', 'm-viejo', 0)");
    await db.exec("insert into of_vault_folder (creator_id, folder_id, name, parent_id) values ('c-1', 'padre', 'NO VENDER', null), ('c-1', 'hijo', 'playa', 'padre')");
    await db.exec(`insert into of_vault_item (creator_id, media_id, title, kind, folder_id, tags, sales, price_cents, synced_at)
      values ('c-1', 'm-viejo', 'clip viejo', 'video', 'hijo', 'Feed', 3, 500, now())`);
    await applyNew(db);
    const kept = await db.query<{ item_key: string; title: string; list_key: string | null; sales_count: number | null }>(
      "select item_key, title, list_key, sales_count from of_vault_item where media_id = 'm-viejo'",
    );
    assert.equal(kept.rows.length, 1);
    assert.equal(kept.rows[0]?.item_key, "m-viejo");
    assert.equal(kept.rows[0]?.title, "clip viejo");
    assert.equal(kept.rows[0]?.list_key, "hijo");
    assert.equal(kept.rows[0]?.sales_count, 3);
    const lists = await db.query<{ list_key: string; parent_key: string | null }>(
      "select list_key, parent_key from of_vault_list where creator_id = 'c-1' order by list_key",
    );
    assert.deepEqual(lists.rows.map((row) => row.list_key), ["hijo", "padre"]);
    assert.equal(lists.rows.find((row) => row.list_key === "hijo")?.parent_key, "padre");
    assert.equal(await count(db, "of_outbound_media"), 1);
    const sql = asSql(db);
    await saveVaultMirror(sql, "c-1", [{
      id: "m-nuevo",
      title: "nuevo",
      kind: "foto",
      seconds: null,
      preview: null,
      folder: "playa",
      tags: ["Sent"],
      listId: "hijo",
      listName: "playa",
      description: null,
      uploadedAt: null,
      priceCents: null,
      salesCount: null,
      sentCount: null,
    }], []);
    const both = await db.query<{ item_key: string }>("select item_key from of_vault_item where creator_id = 'c-1' order by item_key");
    assert.deepEqual(both.rows.map((row) => row.item_key), ["m-nuevo", "m-viejo"]);
    await applyNew(db);
    assert.equal(await count(db, "of_vault_item"), 2);
  } finally {
    await db.close();
  }
});

test("el JSON del chatter trae ventas y no importes, y el filtro de chatter no se salta", async () => {
  const db = new PGlite();
  try {
    await applyNew(db);
    await db.exec(`insert into of_vault_list (creator_id, list_key, name) values ('c-1', 'solas', 'SOLA')`);
    await db.exec(`insert into of_vault_item (creator_id, item_key, title, kind, seconds, folder, tags, list_key, list_name, uploaded_at, price_cents, sales_count, sent_count)
      values
      ('c-1', 'v1', 'set sola', 'video', 40, 'SOLA', '["Feed","Sent"]'::jsonb, 'solas', 'SOLA', '2026-11-01', 1500, 9, 10),
      ('c-1', 'v2', 'sin ficha', 'foto', null, 'otras', '[]'::jsonb, 'solas', 'SOLA', null, null, null, null),
      ('c-1', 'v3', 'audio corto', 'audio', 5, 'SOLA', '[]'::jsonb, 'solas', 'SOLA', '2026-10-01', 0, 1, 4)`);
    await db.exec(`insert into of_vault_fan_send (id, creator_id, fan_key, item_key, sent_at, price_cents, purchased, author_id) values
      ('a', 'c-1', '7', 'v1', '2026-11-02', 1900, true, 'chatter-a'),
      ('b', 'c-1', '7', 'v3', '2026-11-03', 500, false, 'chatter-b')`);
    const seen: string[] = [];
    const sql = asSql(db, seen);
    const response = await handleVaultQuery(jsonRequest({
      creatorId: "c-1",
      fanKey: "7",
      chatterId: "chatter-b",
      query: { text: "sola", kinds: ["video"], minSeconds: 30, offer: "ppv", sent: "si", sort: "ventas", couples: ["SOLA"] },
    }), { session: async () => chatter("chatter-a"), sql });
    assert.equal(response.status, 200);
    const body = await response.json() as { chatterId: string; items: Array<Record<string, unknown>> };
    assert.equal(body.chatterId, "chatter-a");
    assert.equal(body.items.length, 1);
    assert.equal(body.items[0]?.id, "v1");
    assert.equal(body.items[0]?.salesCount, 9);
    assert.equal(body.items[0]?.ventasLabel, "Ventas");
    assert.equal(body.items[0]?.bestSellerLabel, "Más vendido");
    const history = body.items[0]?.history as Array<{ priceLabel: string; purchasedLabel: string; authorLabel: string }>;
    assert.equal(history[0]?.priceLabel, "$19.00");
    assert.equal(history[0]?.purchasedLabel, "comprado");
    assert.equal(history[0]?.authorLabel, "chatter-a");
    assert.equal(vaultCardHasMoney(body), false);
    assert.equal(JSON.stringify(body).includes("priceCents"), false);
    assert.equal(JSON.stringify(body).includes("€"), false);
    assert.equal(seen.some((query) => query.includes("author_id") && query.includes("seconds") && query.includes("price_cents")), true);
    const omitted = await handleVaultQuery(jsonRequest({
      creatorId: "c-1",
      fanKey: "7",
      query: { sent: "si", kinds: ["video"] },
    }), { session: async () => chatter("chatter-a"), sql });
    const again = await omitted.json() as { chatterId: string; items: Array<{ id: string }> };
    assert.equal(again.chatterId, "chatter-a");
    assert.deepEqual(again.items.map((item) => item.id), ["v1"]);
    const restored = await handleVaultQuery(jsonRequest({ creatorId: "c-1", fanKey: "7" }), {
      session: async () => chatter("chatter-a"),
      sql,
    });
    const saved = await restored.json() as { restored: boolean; items: Array<{ id: string }> };
    assert.equal(saved.restored, true);
    assert.deepEqual(saved.items.map((item) => item.id), ["v1"]);
  } finally {
    await db.close();
  }
});

test("sin datos no es un cero y el precio sugerido no se inventa", async () => {
  assert.equal(presentGap(null), "Sin datos");
  assert.equal(presentGap(undefined), "Sin datos");
  assert.notEqual(presentGap(null), "0");
  const invented = suggestVaultPrice({ seconds: 600, folder: "SOLA", title: "pelicula", purchasesCents: [] });
  assert.equal(invented.label, "Sin datos");
  assert.equal(invented.cents, null);
  const real = suggestVaultPrice({ seconds: null, folder: null, title: null, purchasesCents: [1900, 2500] });
  assert.equal(real.label, "$19");
  const db = new PGlite();
  try {
    await applyNew(db);
    await db.exec(`insert into of_vault_item (creator_id, item_key, title, kind, sales_count, price_cents) values ('c-1', 'vacio', 'pieza', 'video', null, null)`);
    const response = await handleVaultQuery(jsonRequest({ creatorId: "c-1", fanKey: null, query: { text: "pieza" } }), {
      session: async () => chatter("chatter-a"),
      sql: asSql(db),
    });
    const body = await response.json() as { items: Array<{ salesCount: number | null; ventasLabel: string; suggestedLabel: string }> };
    assert.equal(body.items[0]?.salesCount, null);
    assert.equal(body.items[0]?.ventasLabel, "Sin datos");
    assert.equal(body.items[0]?.suggestedLabel, "Sin datos");
    assert.equal(JSON.stringify(body.items[0]).includes("\"salesCount\":0"), false);
    assert.equal(JSON.stringify(body.items[0]).includes("\"suggestedLabel\":\"0\""), false);
  } finally {
    await db.close();
  }
});

test("los medios sin sesión responden 401 y el log no lleva la URL", async () => {
  let looked = false;
  const anonymous = await handleChatMedia(new Request("http://127.0.0.1/api/chat-media?creatorId=c&threadKey=7&messageKey=m&index=0"), {
    session: async () => null,
    findMedia: async () => {
      looked = true;
      return { url: "https://cdn2.onlyfans.com/a.mp4?Policy=sekret" };
    },
    fetchBytes: async () => {
      looked = true;
      return null;
    },
  });
  assert.equal(anonymous.status, 401);
  assert.equal(looked, false);
  const vault = await handleVaultMedia(new Request("http://127.0.0.1/api/vault-media?creatorId=c&mediaId=v"), {
    session: async () => null,
    findPreview: async () => "https://cdn3.onlyfans.com/a.jpg?Policy=sekret",
    fetchBytes: async () => null,
  });
  assert.equal(vault.status, 401);
  const forbidden = await handleChatMedia(new Request("http://127.0.0.1/api/chat-media?creatorId=c&threadKey=7&messageKey=m&index=0"), {
    session: async () => ({ userId: "x", role: "member", perms: [] }),
    findMedia: async () => null,
    fetchBytes: async () => null,
  });
  assert.equal(forbidden.status, 403);
  const lines: string[] = [];
  const ok = await handleChatMedia(new Request("http://127.0.0.1/api/chat-media?creatorId=c-1&threadKey=7&messageKey=m1&index=0"), {
    session: async () => chatter("chatter-a"),
    findMedia: async () => ({ url: "https://cdn2.onlyfans.com/clip.mp4?Policy=sekret" }),
    fetchBytes: async () => ({ status: 200, body: Uint8Array.from([1, 2, 3]), contentType: "video/mp4" }),
    log: (line) => lines.push(line),
  });
  assert.equal(ok.status, 200);
  assert.equal(lines.length, 1);
  assert.equal(lines[0]?.includes("http"), false);
  assert.equal(lines[0]?.includes("onlyfans"), false);
  assert.equal(lines[0]?.includes("Policy"), false);
  assert.equal(mediaLogLine("c-1", "https://cdn2.onlyfans.com/a.mp4").includes("http"), false);
  const bytes = new Uint8Array(await ok.arrayBuffer());
  assert.equal(new TextDecoder().decode(bytes).includes("onlyfans"), false);
});

test("NO VENDER bloquea el envío individual y el masivo en la API", async () => {
  const db = new PGlite();
  try {
    await applyNew(db);
    await db.exec(`insert into of_vault_list (creator_id, list_key, name, parent_key) values
      ('9ikis52', 'padre', 'NO-VENDER', null),
      ('9ikis52', 'hijo', 'playa', 'padre')`);
    await db.exec(`insert into of_vault_item (creator_id, item_key, title, folder, list_key, list_name) values ('9ikis52', 'v1', 'clip', 'playa', 'hijo', 'playa')`);
    const env = { FANLINK_ENABLE_SEND: "true", FANLINK_ENABLE_MASS_SEND: "true", FANLINK_SEND_ALLOW_ACCOUNTS: "9ikis52,@bigpoppa1111" };
    let chatOpened = false;
    const chat = await handleVaultSend(jsonRequest({
      mode: "chat",
      creatorId: "9ikis52",
      itemIds: ["v1"],
      accountId: "acc-9",
      handle: "bigpoppa1111",
    }), {
      session: async () => chatter("chatter-a"),
      sql: asSql(db),
      env,
      openChat: async () => {
        chatOpened = true;
        return { messageId: "1", reason: null };
      },
    });
    assert.equal(chat.status, 403);
    const chatBody = await chat.json() as { sent: boolean; opened: boolean; reason: string };
    assert.equal(chatBody.sent, false);
    assert.equal(chatBody.opened, false);
    assert.equal(chatBody.reason, "NO VENDER");
    assert.equal(chatOpened, false);
    let massOpened = false;
    const mass = await handleVaultSend(jsonRequest({
      mode: "mass",
      creatorId: "9ikis52",
      itemIds: ["v1"],
      accountId: "9ikis52",
    }), {
      session: async () => chatter("chatter-a"),
      sql: asSql(db),
      env,
      openMass: async () => {
        massOpened = true;
      },
    });
    assert.equal(mass.status, 403);
    const massBody = await mass.json() as { sent: boolean; opened: boolean; reason: string };
    assert.equal(massBody.opened, false);
    assert.equal(massBody.reason, "NO VENDER");
    assert.equal(massOpened, false);
    assert.equal(itemSaleBlocked({
      folderId: "hijo",
      folderName: "playa",
      title: "clip",
      folders: [
        { id: "a", name: "uno", parentId: "b" },
        { id: "b", name: "dos", parentId: "a" },
      ],
    }), true);
    assert.equal(itemSaleBlocked({
      folderId: "huérfana",
      folderName: "playa",
      title: "clip",
      folders: [{ id: "otra", name: "playa", parentId: null }],
    }), true);
    assert.equal(itemSaleBlocked({
      folderId: null,
      folderName: "SIN EDITAR",
      title: "clip",
      folders: [],
    }), true);
  } finally {
    await db.close();
  }
});

test("deliverIfNoMedia y deliverChatSend no abren el navegador si hay medios", async () => {
  const db = new PGlite();
  try {
    await applyNew(db);
    await db.exec(`insert into of_outbound_media (outbound_id, creator_id, media_id, position) values ('out-1', '9ikis52', 'v1', 0)`);
    let opened = false;
    const blocked = await deliverChatSend({
      flag: "true",
      allowlist: "9ikis52,@bigpoppa1111",
      perMinute: 4,
      account: { creatorId: "9ikis52", accountId: "acc-9", handle: "bigpoppa1111", userId: "42", label: "Prueba" },
      now: () => Date.now(),
      sleep: async () => undefined,
      outboundMedia: { sql: asSql(db), outboundId: "out-1" },
      open: async () => {
        opened = true;
        return { messageId: "1", reason: null };
      },
    });
    assert.equal(blocked.sent, false);
    assert.equal(blocked.opened, false);
    assert.equal(blocked.reason, "El envío de medios no existe");
    assert.equal(opened, false);
    const clear = await deliverChatSend({
      flag: "true",
      allowlist: "@bigpoppa1111",
      perMinute: 4,
      account: { creatorId: "9ikis52", accountId: "acc-9", handle: "bigpoppa1111", userId: "42", label: "Prueba" },
      now: () => Date.now(),
      sleep: async () => undefined,
      outboundMedia: { sql: asSql(db), outboundId: "sin-medios" },
      open: async () => {
        opened = true;
        return { messageId: "2", reason: null };
      },
    });
    assert.equal(clear.sent, true);
    assert.equal(clear.opened, true);
    assert.equal(opened, true);
  } finally {
    await db.close();
  }
});

test("el envío individual y el masivo siguen apagados si los flags no están", async () => {
  const db = new PGlite();
  try {
    await applyNew(db);
    let opened = false;
    const chat = await handleVaultSend(jsonRequest({ mode: "chat", creatorId: "9ikis52", accountId: "9ikis52", handle: "bigpoppa1111" }), {
      session: async () => chatter("chatter-a"),
      sql: asSql(db),
      env: {},
      openChat: async () => {
        opened = true;
        return { messageId: "1", reason: null };
      },
    });
    const chatBody = await chat.json() as { sent: boolean; opened: boolean; reason: string };
    assert.equal(chatBody.sent, false);
    assert.equal(chatBody.opened, false);
    assert.match(chatBody.reason, /desactivado/i);
    const mass = await handleVaultSend(jsonRequest({ mode: "mass", creatorId: "9ikis52", accountId: "9ikis52" }), {
      session: async () => chatter("chatter-a"),
      sql: asSql(db),
      env: {},
      openMass: async () => {
        opened = true;
      },
    });
    const massBody = await mass.json() as { sent: boolean; opened: boolean; reason: string };
    assert.equal(massBody.sent, false);
    assert.equal(massBody.opened, false);
    assert.match(massBody.reason, /FANLINK_ENABLE_SEND/);
    assert.equal(opened, false);
    const previousSend = process.env.FANLINK_ENABLE_SEND;
    const previousMass = process.env.FANLINK_ENABLE_MASS_SEND;
    delete process.env.FANLINK_ENABLE_SEND;
    delete process.env.FANLINK_ENABLE_MASS_SEND;
    assert.notEqual(process.env.FANLINK_ENABLE_SEND, "true");
    assert.notEqual(process.env.FANLINK_ENABLE_MASS_SEND, "true");
    if (previousSend === undefined) delete process.env.FANLINK_ENABLE_SEND;
    else process.env.FANLINK_ENABLE_SEND = previousSend;
    if (previousMass === undefined) delete process.env.FANLINK_ENABLE_MASS_SEND;
    else process.env.FANLINK_ENABLE_MASS_SEND = previousMass;
  } finally {
    await db.close();
  }
});

function chatter(userId: string) {
  return { userId, role: "member" as const, perms: ["vault", "mensajes"] };
}

function jsonRequest(body: unknown): Request {
  return new Request("http://127.0.0.1/api/vault-query", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function asSql(db: PGlite, seen: string[] = []): ReadSql {
  return {
    async query<T>(text: string, params?: unknown[]): Promise<T[]> {
      seen.push(text);
      const result = await db.query<T>(text, params);
      return result.rows;
    },
  };
}

async function applyNew(db: PGlite): Promise<void> {
  for (const file of NEW_FILES) {
    await db.exec(await readFile(path.join(root, "migrations", file), "utf8"));
  }
}

async function count(db: PGlite, table: string): Promise<number> {
  const result = await db.query<{ n: number }>(`select count(*)::int as n from ${table}`);
  return Number(result.rows[0]?.n ?? 0);
}
