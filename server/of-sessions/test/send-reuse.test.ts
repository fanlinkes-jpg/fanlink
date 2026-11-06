import assert from "node:assert/strict";
import { test } from "node:test";
import { composeChat } from "../send/compose.ts";
import { createSessionRuntime } from "../runtime.ts";
import { openWorkPage } from "../sessions/work-page.ts";
import { startFixture } from "./fixture-site.ts";
import {
  completeFixtureLogin,
  recordingFactory,
  removeDir,
  tempDataDir,
  testConfig,
  testDisplay,
} from "./helpers.ts";

test("el envío reutiliza el contexto de la escucha y se confirma por JSON", async () => {
  const dataDir = await tempDataDir();
  const fixture = await startFixture();
  const events: string[] = [];
  const runtime = await createSessionRuntime({
    config: testConfig(dataDir),
    site: fixture.site,
    browserFactory: recordingFactory(events),
    displayEnv: testDisplay,
    afterLoginPageOpen: (page) => completeFixtureLogin(page),
  });
  const account = await runtime.sessions.addAccount("Principal");
  await runtime.sessions.whenLoginSettled(account.id);
  let release: () => void = () => undefined;
  const stopped = new Promise<void>((resolve) => {
    release = resolve;
  });
  let ready: () => void = () => undefined;
  const watching = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const held = runtime.sessions.holdWatch(account.id, async (context) => {
    const page = await openWorkPage(context);
    await page.goto(`${fixture.origin}/my/chats`, { waitUntil: "domcontentloaded" });
    ready();
    await stopped;
    await page.close().catch(() => undefined);
  });
  try {
    await watching;
    const launches = () => events.filter((event) => event.startsWith("persistent:")).length;
    const before = launches();
    const sent = await runtime.sessions.withSession(account.id, (context) => composeChat(context, {
      chatsUrl: `${fixture.origin}/my/chats`,
      siteId: "onlyfans",
      threadKey: "7",
      fanKey: "7",
      accountUserId: "42",
      body: "Hola desde la prueba",
      priceCents: null,
      typeDelayMs: 0,
      confirmMs: 8_000,
    }));
    assert.equal(sent.messageId, "300");
    assert.equal(launches(), before);
    const pages = await runtime.sessions.withSession(account.id, async (context) => context.pages().map((page) => page.url()));
    assert.equal(pages.length, 1);
    assert.equal(pages.some((url) => url === "about:blank"), false);
  } finally {
    release();
    await held;
    await runtime.close();
    await fixture.close();
    await removeDir(dataDir);
  }
});
