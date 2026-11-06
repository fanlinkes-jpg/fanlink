import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { createSessionRuntime } from "../runtime.ts";
import { applyUserDirectory, chatFailureReason, chatIntervalMinFromEnv, classifyChatPath, mergeMessages, mergeThreads, newFanEvents, parseChatList, parseChatMessages, parseUsersDirectory } from "../sync/chats.ts";
import { preferOutcome } from "../sync/parse.ts";
import { shapeSummary } from "../sync/shape.ts";
import { saveChatRead } from "../sync/chat-store.ts";
import type { ReadSql } from "../sync/store.ts";
import { startFixture } from "./fixture-site.ts";
import { completeFixtureLogin, recordingFactory, removeDir, tempDataDir, testConfig, testDisplay } from "./helpers.ts";

test("los chats se leen de rutas de conversación y el aviso no se repite", () => {
  assert.equal(chatIntervalMinFromEnv(undefined), 2);
  assert.equal(chatIntervalMinFromEnv("1"), 1);
  assert.equal(chatIntervalMinFromEnv("90"), 30);
  assert.equal(classifyChatPath("https://onlyfans.com/api2/v2/chats?skip=0&token=sekret"), "list");
  assert.equal(classifyChatPath("https://onlyfans.com/api2/v2/chats/7/messages?order=desc"), "messages");
  assert.equal(classifyChatPath("https://onlyfans.com/my/chats"), "other");
  assert.equal(classifyChatPath("https://onlyfans.com/api2/v2/messages/queue"), "other");
  assert.equal(chatFailureReason({ redirected: false, outcome: "pending", jsonPaths: [] }), "sin datos todavía (chats)");
  assert.equal(chatFailureReason({ redirected: false, outcome: "empty", jsonPaths: [] }), null);
  assert.equal(chatFailureReason({ redirected: false, outcome: "changed", jsonPaths: [] }), "página cambiada (chats)");
  const threads = parseChatList({
    password: "no-guardar",
    list: [{ id: 7, withUser: { id: 7, username: "fanuno", name: "Fan Uno" }, lastMessage: { text: "Hola", createdAt: "2026-11-05T10:00:00.000Z" } }],
  });
  assert.equal(threads[0]?.fanHandle, "fanuno");
  assert.equal(JSON.stringify(threads).includes("no-guardar"), false);
  const messages = parseChatMessages(
    {
      list: [
        { id: 100, text: "Hola, ¿sigues ahí?", createdAt: "2026-11-05T10:00:00.000Z", fromUser: { id: 7 } },
        { id: 101, text: "Sí, dime.", createdAt: "2026-11-05T10:05:00.000Z", fromUser: { id: 42 } },
      ],
    },
    "7",
    "7",
  );
  const first = newFanEvents("c-alba", new Set(), messages, new Map([["7", "Fan Uno"]]));
  assert.equal(first.length, 1);
  assert.equal(first[0]?.excerpt, "Hola, ¿sigues ahí?");
  const second = newFanEvents("c-alba", new Set(["100"]), messages, new Map());
  assert.equal(second.length, 0);
});

test("suma todas las respuestas de chats y completa el nombre con users/list", () => {
  const filtered = { list: [], hasMore: true, nextOffset: 10 };
  const first = {
    list: [{
      withUser: { id: 7 },
      canSendMessage: true,
      unreadMessagesCount: 2,
      lastMessage: {
        id: 100,
        text: "<p>Hola</p>",
        createdAt: "2026-11-05T10:00:00+00:00",
        price: 0,
        isFree: true,
        fromUser: { id: 7 },
        media: [],
      },
    }],
    hasMore: true,
  };
  const second = {
    list: [{
      withUser: { id: 8, username: "otro", name: "Otro" },
      unreadMessagesCount: 0,
      lastMessage: { id: 200, text: "Hey", createdAt: "2026-11-05T11:00:00.000Z", fromUser: { id: 8 }, price: 3, isFree: false },
    }],
    hasMore: false,
  };
  assert.equal(parseChatList(filtered).length, 0);
  const merged = mergeThreads(mergeThreads(parseChatList(filtered), parseChatList(first)), parseChatList(second));
  assert.equal(merged.length, 2);
  assert.equal(merged.find((row) => row.threadKey === "7")?.excerpt, "Hola");
  assert.equal(merged.find((row) => row.threadKey === "7")?.unread, 2);
  const named = applyUserDirectory(merged, parseUsersDirectory({
    "7": { id: 7, username: "fanuno", name: "Fan Uno", avatar: "https://cdn.example/secret-avatar.jpg" },
  }));
  assert.equal(named.find((row) => row.threadKey === "7")?.fanHandle, "fanuno");
  assert.equal(named.find((row) => row.threadKey === "7")?.fanName, "Fan Uno");
  assert.equal(JSON.stringify(named).includes("secret-avatar"), false);
  const messages = mergeMessages(
    parseChatMessages({ list: [], hasMore: true }, "7", "7"),
    parseChatMessages({
      list: [
        { id: 100, text: "<p>Hola</p>", createdAt: "2026-11-05T10:00:00+00:00", price: 5, isFree: false, fromUser: { id: 7 }, media: [] },
        { id: 101, text: "Sí", createdAt: "2026-11-05T10:05:00.000Z", fromUser: { id: 42 }, isFree: true, price: 0 },
      ],
      hasMore: false,
    }, "7", "7"),
  );
  assert.equal(messages.find((row) => row.messageKey === "100")?.body, "Hola");
  assert.equal(messages.find((row) => row.messageKey === "100")?.fromFan, true);
  assert.equal(messages.find((row) => row.messageKey === "100")?.priceCents, 500);
  assert.equal(messages.find((row) => row.messageKey === "101")?.fromFan, false);
  const summary = shapeSummary(first);
  assert.equal(summary.includes("Hola"), false);
  assert.equal(summary.includes("fanuno"), false);
  assert.match(summary, /list=array:1/);
  assert.match(summary, /withUser/);
  assert.equal(preferOutcome("empty", "changed"), "changed");
  assert.equal(preferOutcome("changed", "ok"), "ok");
});

test("el simulador entrega el chat y solo avisa de mensajes nuevos", { timeout: 60_000 }, async () => {
  const dataDir = await tempDataDir();
  const fixture = await startFixture();
  const created = await createSessionRuntime({
    config: testConfig(dataDir),
    site: fixture.site,
    browserFactory: recordingFactory([]),
    displayEnv: testDisplay,
    afterLoginPageOpen: (page) => completeFixtureLogin(page),
  });
  const pg = new PGlite();
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../migrations");
  try {
    for (const name of ["0007_of_reads.sql", "0008_sync_schedule.sql", "0009_of_chats.sql", "0013_chat_price.sql"]) {
      await pg.exec(await readFile(path.join(dir, name), "utf8"));
    }
    const sql: ReadSql = {
      async query<T>(text: string, params?: unknown[]): Promise<T[]> {
        const result = await pg.query<T>(text, params);
        return result.rows;
      },
    };
    const account = await created.sessions.addAccount("Principal", "c-alba");
    await created.sessions.whenLoginSettled(account.id);
    const read = await created.sessions.readCreatorChats(account.id);
    const raw = JSON.stringify(read);
    assert.equal(read.reason, null);
    assert.equal(read.threads[0]?.fanHandle, "fanuno");
    assert.equal(read.messages.some((message) => message.fromFan && message.body.includes("sigues")), true);
    assert.equal(read.messages.some((message) => !message.fromFan && message.body === "Sí, dime." && message.priceCents === 500 && message.purchased === true), true);
    assert.equal(raw.includes("sekret"), false);
    assert.equal(raw.includes("no-guardar"), false);
    const first = await saveChatRead(sql, "c-alba", read);
    assert.equal(first.length, 1);
    const again = await saveChatRead(sql, "c-alba", read);
    assert.equal(again.length, 0);
    fixture.pushFanMessage("¿Sigues por aquí?");
    const next = await created.sessions.readCreatorChats(account.id);
    const events = await saveChatRead(sql, "c-alba", next);
    assert.equal(events.length, 1);
    assert.equal(events[0]?.excerpt, "¿Sigues por aquí?");
    assert.equal(events[0]?.fanName, "Fan Uno");
  } finally {
    await created.close();
    await fixture.close();
    await pg.close();
    await removeDir(dataDir);
  }
});
