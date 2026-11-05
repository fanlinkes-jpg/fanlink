import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createSessionRuntime } from "../runtime.ts";
import { startFixture, type FixtureMode } from "./fixture-site.ts";
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
    assert.equal(live.identityReason, null);
    assert.equal(raw.includes("no-guardar"), false);
    assert.equal(raw.includes("password"), false);
    assert.equal(raw.includes("appToken"), false);

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

async function inspectMode(mode: FixtureMode, expectedHandle = "@Creadora") {
  const dataDir = await tempDataDir();
  const fixture = await startFixture(mode);
  const created = await createSessionRuntime({
    config: testConfig(dataDir),
    site: fixture.site,
    browserFactory: recordingFactory([]),
    displayEnv: testDisplay,
    afterLoginPageOpen: (page) => completeFixtureLogin(page),
  });
  const account = await created.sessions.addAccount("Principal", "c-alba");
  await created.sessions.whenLoginSettled(account.id);
  const live = await created.sessions.inspectConnection(account.id, expectedHandle);
  const raw = await readFile(path.join(dataDir, "accounts.json"), "utf8");
  return {
    live,
    raw,
    async close() {
      await created.close();
      await fixture.close();
      await removeDir(dataDir);
    },
  };
}

test("lee el usuario del estado de la página si no hay users/me", { timeout: 60_000 }, async () => {
  const result = await inspectMode("state");
  try {
    assert.equal(result.live.connection, "live");
    assert.equal(result.live.identityState, "verified");
    assert.equal(result.live.identityHandle, "creadora");
    assert.equal(result.live.identityName, "Desde estado");
    assert.equal(result.live.identityUserId, "99");
    assert.equal(result.raw.includes("no-guardar"), false);
  } finally {
    await result.close();
  }
});

test("lee el username del enlace del menú", { timeout: 60_000 }, async () => {
  const result = await inspectMode("menu");
  try {
    assert.equal(result.live.connection, "live");
    assert.equal(result.live.identityState, "verified");
    assert.equal(result.live.identityHandle, "creadora");
    assert.equal(result.raw.includes("secret"), false);
    assert.equal(result.raw.includes("ref="), false);
  } finally {
    await result.close();
  }
});

test("si la home no pide al usuario, lo lee al abrir el perfil", { timeout: 60_000 }, async () => {
  const result = await inspectMode("profile");
  try {
    assert.equal(result.live.connection, "live");
    assert.equal(result.live.identityState, "verified");
    assert.equal(result.live.identityHandle, "creadora");
    assert.equal(result.live.identityUserId, "42");
    assert.equal(result.raw.includes("appToken"), false);
  } finally {
    await result.close();
  }
});

test("si no hay username guarda la razón y las rutas json sin query", { timeout: 60_000 }, async () => {
  const missing = await inspectMode("missing-username");
  try {
    assert.equal(missing.live.connection, "live");
    assert.equal(missing.live.identityState, "unavailable");
    assert.match(missing.live.identityReason ?? "", /campo username ausente/);
    assert.match(missing.live.identityReason ?? "", /\/api2\/v2\/users\/me/);
    assert.equal(missing.live.identityReason?.includes("appToken"), false);
    assert.equal(missing.live.identityReason?.includes("no-guardar"), false);
    assert.equal(missing.raw.includes("no-guardar"), false);
    assert.equal(missing.raw.includes("appToken"), false);
  } finally {
    await missing.close();
  }

  const none = await inspectMode("none");
  try {
    assert.equal(none.live.connection, "live");
    assert.equal(none.live.identityState, "unavailable");
    assert.match(none.live.identityReason ?? "", /no hubo respuesta users\/me/);
    assert.match(none.live.identityReason ?? "", /\/api2\/v2\/init/);
    assert.equal(none.live.identityReason?.includes("sekret"), false);
    assert.equal(none.live.identityReason?.includes("?"), false);
    assert.equal(none.raw.includes("sekret"), false);
  } finally {
    await none.close();
  }
});
