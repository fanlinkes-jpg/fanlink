import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { writeEncryptedSession } from "../crypto.ts";
import { createSessionRuntime } from "../runtime.ts";
import { startFixture } from "./fixture-site.ts";
import { completeFixtureLogin, recordingFactory, removeDir, tempDataDir, TEST_SESSION_KEY, testConfig, testDisplay } from "./helpers.ts";

test("tras rotar sess en el perfil, readStorageState devuelve la cookie nueva y al reabrir /api/me responde 200", { timeout: 90_000 }, async () => {
  const dataDir = await tempDataDir();
  const fixture = await startFixture();
  const created = await createSessionRuntime({
    config: testConfig(dataDir),
    site: fixture.site,
    browserFactory: recordingFactory([]),
    displayEnv: testDisplay,
    afterLoginPageOpen: (page) => completeFixtureLogin(page),
  });
  const sessions = created.sessions;
  try {
    const account = await sessions.addAccount("Rota");
    await sessions.whenLoginSettled(account.id);
    assert.equal((await sessions.getAccount(account.id)).status, "active");
    const before = (await sessions.readStorageState(account.id)).cookies.find((cookie) => cookie.name === "sess")?.value;
    assert.equal(before, "ok-1");

    // El servidor rota la sesión: invalida ok-1 y el navegador recibe ok-2.
    let aliveInsideBrowser = false;
    await sessions.withSession(account.id, async (context) => {
      fixture.invalidate();
      await context.addCookies([{ name: "sess", value: "ok-2", url: fixture.origin }]);
      const page = await context.newPage();
      const res = await page.goto(`${fixture.origin}/api/me`);
      aliveInsideBrowser = res?.status() === 200;
      await page.close();
    });
    assert.equal(aliveInsideBrowser, true, "con la cookie rotada el navegador sigue dentro");

    const after = (await sessions.readStorageState(account.id)).cookies.find((cookie) => cookie.name === "sess")?.value;
    assert.equal(after, "ok-2");

    let reopenedStatus = 0;
    let reopenedSess = "";
    await sessions.withSession(account.id, async (context) => {
      reopenedSess = (await context.cookies()).find((cookie) => cookie.name === "sess")?.value ?? "";
      const page = await context.newPage();
      const res = await page.goto(`${fixture.origin}/api/me`);
      reopenedStatus = res?.status() ?? 0;
      await page.close();
    });
    assert.equal(reopenedSess, "ok-2");
    assert.equal(reopenedStatus, 200);
  } finally {
    await created.close();
    await fixture.close();
    await removeDir(dataDir);
  }
});

test("al reabrir el perfil no se repone una sess más vieja que la que ya tiene", { timeout: 90_000 }, async () => {
  const dataDir = await tempDataDir();
  const fixture = await startFixture();
  const created = await createSessionRuntime({
    config: testConfig(dataDir),
    site: fixture.site,
    browserFactory: recordingFactory([]),
    displayEnv: testDisplay,
    afterLoginPageOpen: (page) => completeFixtureLogin(page),
  });
  const sessions = created.sessions;
  try {
    const account = await sessions.addAccount("Fresca");
    await sessions.whenLoginSettled(account.id);
    await sessions.withSession(account.id, async (context) => {
      fixture.invalidate();
      await context.addCookies([{
        name: "sess",
        value: "ok-2",
        url: fixture.origin,
        expires: Math.floor(Date.now() / 1000) + 86_400,
      }]);
    });
    const fresh = await sessions.readStorageState(account.id);
    await writeEncryptedSession(
      path.join(dataDir, "sessions", `${account.id}.json`),
      {
        ...fresh,
        cookies: fresh.cookies.map((cookie) => cookie.name === "sess" ? { ...cookie, value: "ok-1" } : cookie),
      },
      TEST_SESSION_KEY,
    );
    let reopenedSess = "";
    let reopenedStatus = 0;
    await sessions.withSession(account.id, async (context) => {
      reopenedSess = (await context.cookies()).find((cookie) => cookie.name === "sess")?.value ?? "";
      const page = await context.newPage();
      const res = await page.goto(`${fixture.origin}/api/me`);
      reopenedStatus = res?.status() ?? 0;
      await page.close();
    });
    assert.equal(reopenedSess, "ok-2");
    assert.equal(reopenedStatus, 200);
  } finally {
    await created.close();
    await fixture.close();
    await removeDir(dataDir);
  }
});
