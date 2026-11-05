import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { createSessionRuntime } from "../runtime.ts";
import { chatIntervalMinFromEnv, classifyChatPath, newFanEvents, parseChatList, parseChatMessages } from "../sync/chats.ts";
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
    for (const name of ["0007_of_reads.sql", "0008_sync_schedule.sql", "0009_of_chats.sql"]) {
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
    assert.equal(read.messages.some((message) => !message.fromFan && message.body === "Sí, dime."), true);
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
