import assert from "node:assert/strict";
import { test } from "node:test";
import type { Page } from "playwright";
import { createSessionRuntime } from "../runtime.ts";
import { startFixture } from "./fixture-site.ts";
import { completeFixtureLogin, recordingFactory, removeDir, tempDataDir, testConfig, testDisplay } from "./helpers.ts";

test("Fans en línea no se cuelga si Conectar tiene el perfil y dice que hay que esperar", { timeout: 90_000 }, async () => {
  const dataDir = await tempDataDir();
  const fixture = await startFixture();
  let releaseLogin: () => void = () => undefined;
  const opened = new Promise<void>((resolve) => {
    releaseLogin = resolve;
  });
  let continueLogin: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    continueLogin = resolve;
  });
  const created = await createSessionRuntime({
    config: testConfig(dataDir),
    site: fixture.site,
    browserFactory: recordingFactory([]),
    displayEnv: testDisplay,
    afterLoginPageOpen: async (page) => {
      releaseLogin();
      await gate;
      await completeFixtureLogin(page);
    },
  });
  try {
    const account = await created.sessions.addAccount("En línea");
    await opened;
    const started = Date.now();
    const read = await created.sessions.readOnlineFans(account.id);
    assert.ok(Date.now() - started < 5_000, "Fans en línea esperó al login");
    assert.equal(read.fans.length, 0);
    assert.match(read.reason ?? "", /Conectar/);
  } finally {
    continueLogin();
    await created.sessions.whenLoginSettled((await created.sessions.listAccounts())[0]?.id ?? "").catch(() => undefined);
    await created.close();
    await fixture.close();
    await removeDir(dataDir);
  }
});

test("Fans en línea no pisa la página de la escucha", { timeout: 90_000 }, async () => {
  const dataDir = await tempDataDir();
  const fixture = await startFixture();
  const created = await createSessionRuntime({
    config: testConfig(dataDir),
    site: fixture.site,
    browserFactory: recordingFactory([]),
    displayEnv: testDisplay,
    afterLoginPageOpen: (page) => completeFixtureLogin(page),
  });
  let stopWatch: () => void = () => undefined;
  const stopped = new Promise<void>((resolve) => {
    stopWatch = resolve;
  });
  let watchPage: Page | undefined;
  try {
    const account = await created.sessions.addAccount("Escucha");
    await created.sessions.whenLoginSettled(account.id);
    let ready: () => void = () => undefined;
    const watching = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const held = created.sessions.holdWatch(account.id, async (context) => {
      watchPage = context.pages()[0] ?? await context.newPage();
      await watchPage.goto(`${fixture.origin}/my/chats`, { waitUntil: "domcontentloaded" });
      ready();
      await stopped;
    });
    await watching;
    const before = watchPage?.url();
    const started = Date.now();
    const read = await created.sessions.readOnlineFans(account.id);
    assert.ok(Date.now() - started < 5_000);
    assert.equal(read.reason, "Ocupado.");
    assert.equal(watchPage?.url(), before);
    assert.match(watchPage?.url() ?? "", /\/my\/chats$/);
    stopWatch();
    await held;
  } finally {
    stopWatch();
    await created.close();
    await fixture.close();
    await removeDir(dataDir);
  }
});
