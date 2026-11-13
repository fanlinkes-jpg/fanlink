import assert from "node:assert/strict";
import { createServer } from "node:http";
import path from "node:path";
import { test } from "node:test";
import { WebSocket } from "ws";
import { attachLiveView } from "../live/attach.ts";
import { stopLiveRooms, useLiveOpener } from "../live/room.ts";
import { issueLiveTicket } from "../live/tickets.ts";
import { createSessionRuntime } from "../runtime.ts";
import type { BrowserFactory } from "../sessions/browser-factory.ts";
import { startFixture } from "./fixture-site.ts";
import { completeFixtureLogin, recordingFactory, removeDir, tempDataDir, testConfig, testDisplay } from "./helpers.ts";

test("como máximo un Chromium vivo por perfil entre login, sala, escucha y lecturas", { timeout: 120_000 }, async () => {
  const dataDir = await tempDataDir();
  const fixture = await startFixture();
  const events: string[] = [];
  const live = { max: 0, current: new Map<string, number>() };
  const created = await createSessionRuntime({
    config: testConfig(dataDir),
    site: fixture.site,
    browserFactory: countingFactory(events, live),
    displayEnv: testDisplay,
    afterLoginPageOpen: (page) => completeFixtureLogin(page),
  });
  const sessions = created.sessions;
  const server = createServer();
  attachLiveView(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  const port = address && typeof address === "object" ? address.port : 0;
  try {
    const account = await sessions.addAccount("Dueño");
    await sessions.whenLoginSettled(account.id);
    assert.equal((await sessions.getAccount(account.id)).status, "active");
    assert.equal(live.max, 1, "el login de alta ya abrió dos perfiles");
    live.max = 0;

    let stopWatch: () => void = () => undefined;
    const stopped = new Promise<void>((resolve) => {
      stopWatch = resolve;
    });
    useLiveOpener({
      borrow: (accountId) => sessions.borrowProfile(accountId),
      async open() {
        return { async send() {}, acceptFile() {}, async stop() {} };
      },
    });
    const profileDir = path.join(dataDir, "profiles", account.id);
    const tasks = Promise.allSettled([
      (async () => {
        const held = await sessions.borrowProfile(account.id);
        await wait(250);
        await held.release();
      })(),
      sessions.holdWatch(account.id, async () => {
        await stopped;
      }),
      sessions.runQueued(account.id, async () => "queued", { wait: true }),
      sessions.readCreatorChats(account.id),
      joinLive(port, `http://127.0.0.1:${port}`, account.id),
      (async () => {
        await wait(50);
        await sessions.beginInteractiveLogin(account.id);
        await sessions.whenLoginSettled(account.id);
      })(),
    ]);
    await wait(400);
    stopWatch();
    await tasks;
    await sessions.whenLoginSettled(account.id);
    const after = await sessions.getAccount(account.id);
    assert.equal(after.loginInProgress, false);
    assert.ok(live.max <= 1, `contextos vivos a la vez sobre ${path.basename(profileDir)}: ${live.max}`);
    const persistent = events.filter((event) => event.startsWith("persistent:") && event.endsWith(account.id));
    assert.ok(persistent.length >= 1);
  } finally {
    useLiveOpener(null);
    await stopLiveRooms();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await created.close();
    await fixture.close();
    await removeDir(dataDir);
  }
});

function countingFactory(
  events: string[],
  live: { max: number; current: Map<string, number> },
): BrowserFactory {
  const base = recordingFactory(events);
  return {
    launch: () => base.launch(),
    async launchPersistentContext(userDataDir, options) {
      const count = (live.current.get(userDataDir) ?? 0) + 1;
      live.current.set(userDataDir, count);
      if (count > live.max) live.max = count;
      try {
        const context = await base.launchPersistentContext(userDataDir, options);
        let dropped = false;
        const drop = () => {
          if (dropped) return;
          dropped = true;
          live.current.set(userDataDir, Math.max(0, (live.current.get(userDataDir) ?? 1) - 1));
        };
        const originalClose = context.close.bind(context);
        context.close = async () => {
          try {
            await originalClose();
          } finally {
            drop();
          }
        };
        context.on("close", drop);
        return context;
      } catch (error) {
        live.current.set(userDataDir, Math.max(0, count - 1));
        throw error;
      }
    },
  };
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function joinLive(port: number, origin: string, accountId: string): Promise<void> {
  const ticket = issueLiveTicket({
    userId: "ana",
    accountId,
    creatorId: "c",
    threadKey: "inbox",
    fanKey: null,
    accountUserId: "42",
  });
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(), 4_000);
    const socket = new WebSocket(`ws://127.0.0.1:${port}/api/live-view`, { headers: { origin } });
    const finish = () => {
      clearTimeout(timer);
      socket.close();
      resolve();
    };
    socket.on("error", finish);
    socket.on("open", () => socket.send(JSON.stringify({ type: "auth", ticket })));
    socket.on("message", (data) => {
      const text = typeof data === "string" ? data : data.toString();
      if (text.includes("role") || text.includes("bye")) finish();
    });
  });
}
