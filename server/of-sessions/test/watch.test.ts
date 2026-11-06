import assert from "node:assert/strict";
import { test } from "node:test";
import { parseLivePayload } from "../sync/live-frames.ts";
import { FALLBACK_RELOAD_MS, planWatch } from "../sync/watch-plan.ts";
import { runInboxWatch, type WatchSession } from "../sync/inbox-watch.ts";

test("un frame de socket con mensaje se guarda y uno de tecleo no inventa texto", () => {
  const parsed = parseLivePayload(
    `42["chat",{"list":[{"id":9,"text":"hola","createdAt":"2026-11-06T10:00:00.000Z","fromUser":{"id":7}}]}]`,
    "7",
    "7",
  );
  assert.equal(parsed.messages.length, 1);
  assert.equal(parsed.messages[0]?.body, "hola");
  assert.equal(parsed.messages[0]?.fromFan, true);
  const typing = parseLivePayload(`{"typing":true}`, "7", "7");
  assert.equal(typing.typing, true);
  assert.equal(typing.messages.length, 0);
});

test("sin socket solo se recarga el hilo pasado el mínimo de 15 s", async () => {
  let now = 0;
  const gotos: string[] = [];
  const session = fakeSession(gotos);
  let watchers = 1;
  const task = runInboxWatch({
    stopped: () => now > 20_000,
    target: () => ({
      accountId: "a",
      creatorId: "c",
      threadKey: "7",
      watchers,
      chatsUrl: "https://onlyfans.com/my/chats",
      siteId: "onlyfans",
    }),
    open: async () => session,
    save: async () => undefined,
    onBlock: () => undefined,
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
    paceMs: 1_000,
    blockMs: 15_000,
  });
  await task;
  assert.equal(gotos[0], "https://onlyfans.com/my/chats/chat/7");
  assert.ok(gotos.length >= 2);
  assert.ok(FALLBACK_RELOAD_MS >= 15_000);
  const early = planWatch({
    watchers: 1,
    wantedThread: "7",
    pageThread: "7",
    pageOpen: true,
    lastNavAt: 0,
    lastUsefulAt: null,
    lastReloadAt: null,
    lastWatcherAt: 0,
    now: 1_000,
    blockedUntil: null,
  });
  assert.equal(early, "hold");
  watchers = 0;
});

function fakeSession(gotos: string[]): WatchSession {
  return {
    async goto(url: string) {
      gotos.push(url);
      return 200;
    },
    listen() {
      return undefined;
    },
    async close() {
      return undefined;
    },
  };
}
