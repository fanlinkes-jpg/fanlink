import assert from "node:assert/strict";
import { test } from "node:test";
import { parseLivePayload } from "../sync/live-frames.ts";
import { FALLBACK_RELOAD_MS, MAX_FALLBACK_THREADS, nextFallbackThread, pickAccountWatch, planWatch, rankWatchedThreads } from "../sync/watch-plan.ts";
import { runInboxWatch, type WatchSession, type WatchTarget } from "../sync/inbox-watch.ts";

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
  const gotos: Array<{ url: string; at: number }> = [];
  const session = fakeSession(gotos, () => now);
  const task = runInboxWatch({
    stopped: () => now > 20_000,
    target: () => accountTarget([{ threadKey: "7", watchers: 1 }]),
    open: async () => session,
    save: async () => undefined,
    onBlock: () => 15_000,
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
  });
  await task;
  assert.equal(gotos[0]?.url, "https://onlyfans.com/my/chats");
  assert.equal(gotos[1]?.url, "https://onlyfans.com/my/chats/chat/7");
  assert.ok((gotos[1]?.at ?? 0) >= FALLBACK_RELOAD_MS);
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
});

test("un frame sin chatId no se asigna al hilo de la pestaña si el usuario no coincide", () => {
  const foreign = parseLivePayload(
    JSON.stringify({
      list: [{ id: 3, text: "ajeno", createdAt: "2026-11-06T10:00:00.000Z", fromUser: { id: "9" } }],
    }),
    "7",
    "7",
  );
  assert.equal(foreign.messages.length, 0);
  const checked = parseLivePayload(
    JSON.stringify({
      list: [{
        id: 4,
        text: "de este hilo",
        createdAt: "2026-11-06T10:00:00.000Z",
        fromUser: { id: "cuenta" },
        withUser: { id: "7" },
      }],
    }),
    "7",
    "7",
  );
  assert.equal(checked.messages.length, 1);
  assert.equal(checked.messages[0]?.threadKey, "7");
  assert.equal(checked.messages[0]?.body, "de este hilo");
});

test("un frame reparte cada mensaje a su chat aunque la pestaña sea de la cuenta", () => {
  const parsed = parseLivePayload(
    JSON.stringify({
      list: [
        { id: 1, text: "uno", createdAt: "2026-11-06T10:00:00.000Z", chatId: "7", fromUser: { id: "7" } },
        { id: 2, text: "dos", createdAt: "2026-11-06T10:00:01.000Z", chatId: "8", fromUser: { id: "8" } },
      ],
    }),
    "7",
    "7",
  );
  assert.deepEqual(parsed.messages.map((message) => message.threadKey), ["7", "8"]);
});

test("el respaldo rota por watchers, con 15 s por hilo y tope de 8", () => {
  const ranked = rankWatchedThreads([
    { threadKey: "cold" },
    { threadKey: "hot" },
    { threadKey: "hot" },
    { threadKey: "hot" },
    { threadKey: null },
  ]);
  assert.equal(ranked[0]?.threadKey, "hot");
  assert.equal(ranked[0]?.watchers, 3);
  const picked = pickAccountWatch([
    { creatorId: "poca", threadKey: "1" },
    { creatorId: "mucha", threadKey: "a" },
    { creatorId: "mucha", threadKey: "b" },
  ]);
  assert.equal(picked?.creatorId, "mucha");
  const reloaded = new Map<string, number>();
  assert.equal(nextFallbackThread(ranked, reloaded, 0, null, 1_000), null);
  assert.equal(nextFallbackThread(ranked, reloaded, 0, null, 15_000), "hot");
  reloaded.set("hot", 15_000);
  assert.equal(nextFallbackThread(ranked, reloaded, 0, 15_000, 16_000), null);
  assert.equal(nextFallbackThread(ranked, reloaded, 0, 15_000, 30_000), "cold");
  const crowded = Array.from({ length: MAX_FALLBACK_THREADS + 1 }, (_, index) => ({
    threadKey: `t-${index}`,
    watchers: MAX_FALLBACK_THREADS + 1 - index,
  }));
  const outside = crowded[MAX_FALLBACK_THREADS]?.threadKey;
  const seen = new Set<string>();
  let global: number | null = null;
  let at = 15_000;
  for (let step = 0; step < MAX_FALLBACK_THREADS + 2; step += 1) {
    const next = nextFallbackThread(crowded, reloaded, 0, global, at);
    if (next) {
      seen.add(next);
      reloaded.set(next, at);
      global = at;
    }
    at += 15_000;
  }
  assert.equal(seen.has(outside ?? ""), false);
  assert.equal(seen.size, MAX_FALLBACK_THREADS);
});

test("un 429 no reabre la pestaña antes de la pausa que devuelve el backoff", async () => {
  let now = 0;
  let calls = 0;
  const gotos: number[] = [];
  const session: WatchSession = {
    async goto() {
      calls += 1;
      gotos.push(now);
      return calls === 1 ? 429 : 200;
    },
    listen() {
      return undefined;
    },
    async close() {
      return undefined;
    },
  };
  await runInboxWatch({
    stopped: () => now > 70_000,
    target: () => accountTarget([{ threadKey: "7", watchers: 1 }]),
    open: async () => session,
    save: async () => undefined,
    onBlock: () => 60_000,
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
  });
  assert.deepEqual(gotos.filter((at) => at < 60_000), [0]);
  assert.ok((gotos[1] ?? 0) >= 60_000);
});

function accountTarget(threads: WatchTarget["threads"]): WatchTarget {
  return {
    accountId: "a",
    creatorId: "c",
    threads,
    watchers: threads.reduce((sum, thread) => sum + thread.watchers, 0),
    chatsUrl: "https://onlyfans.com/my/chats",
    siteId: "onlyfans",
  };
}

function fakeSession(gotos: Array<{ url: string; at: number }>, now: () => number): WatchSession {
  return {
    async goto(url: string) {
      gotos.push({ url, at: now() });
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
