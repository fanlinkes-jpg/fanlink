import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createSessionRuntime } from "../runtime.ts";
import { startFixture } from "./fixture-site.ts";
import { completeFixtureLogin, recordingFactory, removeDir, tempDataDir, testConfig, testDisplay } from "./helpers.ts";

test("la comprobación no convierte las cookies en la conexión y lee la identidad del sitio de prueba", { timeout: 60_000 }, async () => {
  const dataDir = await tempDataDir();
  const fixture = await startFixture();
  const created = await createSessionRuntime({
    config: testConfig(dataDir),
    site: fixture.site,
    browserFactory: recordingFactory([]),
    displayEnv: testDisplay,
    afterLoginPageOpen: (page) => completeFixtureLogin(page),
  });
  try {
    const account = await created.sessions.addAccount("Principal", "c-alba");
    await created.sessions.whenLoginSettled(account.id);
    const stored = await created.sessions.getAccount(account.id);
    assert.equal(stored.status, "active");
    assert.equal(stored.connection, "not_checked");
    assert.equal(stored.identityState, "unavailable");

    const live = await created.sessions.inspectConnection(account.id, "@Creadora");
    assert.equal(live.status, "active");
    assert.equal(live.connection, "live");
    assert.equal(live.identityState, "verified");
    assert.equal(live.identityHandle, "creadora");
    assert.equal(live.identityName, "Creadora de prueba");
    assert.equal(live.identityUserId, "42");
    assert.ok(live.identityCheckedAt);
    const raw = await readFile(path.join(dataDir, "accounts.json"), "utf8");
    assert.equal(raw.includes("no-guardar"), false);
    assert.equal(raw.includes("password"), false);

    const other = await created.sessions.inspectConnection(account.id, "@otra");
    assert.equal(other.status, "active");
    assert.equal(other.connection, "live");
    assert.equal(other.identityState, "mismatch");
    assert.equal(other.identityHandle, "creadora");

    fixture.invalidate();
    const rejected = await created.sessions.inspectConnection(account.id, "@Creadora");
    assert.equal(rejected.status, "active");
    assert.equal(rejected.connection, "rejected");
    assert.equal(rejected.identityState, "unavailable");
    assert.equal(rejected.identityLabel, null);
  } finally {
    await created.close();
    await fixture.close();
    await removeDir(dataDir);
  }
});
