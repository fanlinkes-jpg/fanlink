import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { parseChatList } from "../sync/chats.ts";
import { pauseWaitReason } from "../sync/backoff.ts";
import { liveRequestAllowed } from "../live/desk.ts";
import { saveChatRead } from "../sync/chat-store.ts";
import type { ReadSql } from "../sync/store.ts";
import { noteMissingUnread, unreadAfterListRead, unreadChatRow, unreadTotalFor } from "../sync/unread-chats.ts";

const at = "2026-11-12T00:00:00.000Z";

function chat(id: string, unread?: number) {
  const row: Record<string, unknown> = {
    withUser: { id, name: `Fan ${id}` },
    lastMessage: { id: `p-${id}`, text: "previo", createdAt: at, fromUser: { id } },
  };
  if (unread != null) row.unreadMessagesCount = unread;
  return row;
}

test("dos de tres chats sin leer salen en negrita, con badge y total 2", () => {
  const threads = parseChatList({ list: [chat("1", 4), chat("2", 1), chat("3", 0)] }, "42")
    .map((thread) => ({ creatorId: "3zk7kbr", threadKey: thread.threadKey, unread: thread.unread }));
  const rows = threads.map((thread) => unreadChatRow(thread.unread));
  assert.equal(unreadTotalFor("ready", threads, "3zk7kbr"), 2);
  assert.equal(rows.filter((row) => row.bold).length, 2);
  assert.deepEqual(rows.map((row) => row.badge), [4, 1, null]);
  assert.equal(rows[2]?.bold, false);
});

test("el total es Sin datos al cargar, si falla o si nadie trae unreadMessagesCount", () => {
  const known = [{ creatorId: "3zk7kbr", unread: 2 }];
  assert.equal(unreadTotalFor("loading", known, "3zk7kbr"), null);
  assert.equal(unreadTotalFor("error", known, "3zk7kbr"), null);
  assert.equal(unreadTotalFor("ready", [{ creatorId: "3zk7kbr", unread: null }], "3zk7kbr"), null);
  assert.equal(unreadTotalFor("ready", [], "3zk7kbr"), null);
  assert.equal(unreadTotalFor("ready", known, "otra"), null);
  assert.equal(unreadTotalFor("ready", known, "3zk7kbr"), 1);
});

test("sin unreadMessagesCount no se inventa un 0 y el log lleva creator=", () => {
  const lines: string[] = [];
  const threads = parseChatList({ list: [chat("9")] }, "42");
  assert.equal(threads[0]?.unread, null);
  assert.deepEqual(unreadChatRow(threads[0]?.unread ?? null), { bold: false, badge: null });
  noteMissingUnread("3zk7kbr", threads.filter((thread) => thread.unread == null).length, (line) => lines.push(line));
  assert.equal(lines[0], "[fanlink:chat] api lista creator=3zk7kbr sin unreadMessagesCount hilos=1");
  assert.equal(lines[0]?.includes("unread=0"), false);
});

test("un hilo por debajo de la posición 60 con unread antiguo no entra en el total", () => {
  const listed = Array.from({ length: 60 }, (_, index) => ({
    threadKey: String(index + 1),
    unread: index < 2 ? 3 : 0,
  }));
  const stored = [
    ...listed.map((thread) => ({ creatorId: "3zk7kbr", ...thread, unread: 9 })),
    { creatorId: "3zk7kbr", threadKey: "61", unread: 7 },
  ];
  const next = unreadAfterListRead(stored, listed);
  assert.equal(next.find((thread) => thread.threadKey === "61")?.unread, null);
  assert.equal(unreadTotalFor("ready", next, "3zk7kbr"), 2);
});

test("una pausa que no es un 400 no dice que OnlyFans rechazó la firma", () => {
  const now = 1_700_000_000_000;
  const limited = pauseWaitReason({ reason: "429", until: now + 3_200 }, now);
  assert.equal(limited.signatureRejected, false);
  assert.equal(limited.reason, "pausa por 429 (espera 4 s)");
  const signed = pauseWaitReason({ reason: "400", until: now + 15_000 }, now);
  assert.equal(signed.signatureRejected, true);
  assert.equal(signed.reason, "OnlyFans rechazó la firma");
});

test("un hilo nacido de un mensaje no se inventa los no leídos y la lista borra el antiguo", async () => {
  const pg = new PGlite();
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../migrations");
  for (const name of ["0007_of_reads.sql", "0008_sync_schedule.sql", "0009_of_chats.sql", "0013_chat_price.sql", "0018_chat_preview.sql", "0019_chat_author.sql", "0020_chat_card.sql", "0021_fan_profile.sql", "0022_message_media.sql", "0024_outbound_schedule.sql", "0025_outbound_send.sql", "0026_chat_history.sql", "0045_chat_unread_null.sql"]) {
    await pg.exec(await readFile(path.join(dir, name), "utf8"));
  }
  const sql: ReadSql = {
    async query<T>(text: string, params?: unknown[]): Promise<T[]> {
      const result = await pg.query<T>(text, params);
      return result.rows;
    },
  };
  await saveChatRead(sql, "3zk7kbr", {
    reason: null,
    jsonPaths: [],
    threads: [],
    messages: [{
      messageKey: "m-old",
      threadKey: "61",
      fanKey: "61",
      body: "hola",
      sentAt: "2026-11-12T00:00:00.000Z",
      priceCents: null,
      purchased: null,
      seen: null,
      automatic: false,
      fromFan: true,
      fromUserId: "61",
    }],
  });
  const born = await sql.query<{ unread: number | null }>("select unread from of_chat_thread where thread_key = '61'");
  assert.equal(born[0]?.unread, null);
  await sql.query("update of_chat_thread set unread = 7 where thread_key = '61'");
  await saveChatRead(sql, "3zk7kbr", {
    reason: null,
    jsonPaths: [],
    threads: Array.from({ length: 60 }, (_, index) => ({
      threadKey: String(index + 1),
      fanKey: String(index + 1),
      fanHandle: null,
      fanName: `Fan ${index + 1}`,
      lastMessageAt: "2026-11-13T00:00:00.000Z",
      excerpt: "nuevo",
      unread: index < 2 ? 3 : 0,
      lastFromUserId: null,
      lastFromFan: true,
      spentCents: null,
      subscribesCents: null,
      tipsCents: null,
      postsCents: null,
      messagesCents: null,
      avatarUrl: null,
      online: null,
      subPriceCents: null,
      subExpiresAt: null,
      renewAuto: null,
    })),
    messages: [],
  });
  const old = await sql.query<{ unread: number | null }>("select unread from of_chat_thread where thread_key = '61'");
  assert.equal(old[0]?.unread, null);
  const fresh = await sql.query<{ n: number }>("select count(*)::int as n from of_chat_thread where creator_id = '3zk7kbr' and unread > 0");
  assert.equal(Number(fresh[0]?.n), 2);
  await pg.close();
});

test("ni la vista en directo ni un POST de leído salen hacia OnlyFans", () => {
  const read = "https://onlyfans.com/api2/v2/chats/7/messages/read";
  assert.equal(liveRequestAllowed(read, "POST", false), false);
  assert.equal(liveRequestAllowed(read, "POST", true), false);
  assert.equal(liveRequestAllowed("https://onlyfans.com/api2/v2/chats/7/messages", "GET", false), true);
});
