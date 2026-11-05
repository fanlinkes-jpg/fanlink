import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { chromium } from "playwright";
import { createApp } from "../src/app.js";
import { startFixture } from "./fixture-site.js";
import {
  completeFixtureLogin,
  listen,
  recordingFactory,
  removeDir,
  tempDataDir,
  testConfig,
  testDisplay,
} from "./helpers.js";

const artifacts = "/opt/cursor/artifacts";

test("la interfaz recorre activa y pendiente sin pedir contraseña", { timeout: 60_000 }, async () => {
  await mkdir(artifacts, { recursive: true });
  const dataDir = await tempDataDir();
  const fixture = await startFixture();
  let logins = 0;
  let releaseSecond = (): void => undefined;
  const secondLogin = new Promise<void>((resolve) => {
    releaseSecond = resolve;
  });
  const created = await createApp({
    config: testConfig(dataDir),
    site: fixture.site,
    browserFactory: recordingFactory([]),
    displayEnv: testDisplay,
    afterLoginPageOpen: async (page) => {
      logins += 1;
      if (logins > 1) await secondLogin;
      await completeFixtureLogin(page);
    },
  });
  const server = await listen(created.app);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  try {
    await page.goto(server.url);
    assert.equal(await page.locator('input[type="password"]').count(), 0);
    await page.getByLabel("Nombre de la cuenta").fill("Cuenta principal");
    await page.getByRole("button", { name: "Añadir cuenta" }).click();
    await page.locator('[data-status="active"]').waitFor({ timeout: 30_000 });
    assert.equal(await page.locator(".status").innerText(), "Activa");
    await page.screenshot({ path: path.join(artifacts, "fanlink-activa.png"), fullPage: true });

    fixture.invalidate();
    await page.getByRole("button", { name: "Comprobar sesión" }).click();
    await page.locator('[data-status="pending_login"]').waitFor({ timeout: 30_000 });
    assert.equal(await page.locator(".status").innerText(), "Pendiente de login");
    await page.screenshot({ path: path.join(artifacts, "fanlink-pendiente.png"), fullPage: true });
    releaseSecond();
    await page.locator('[data-status="active"]').waitFor({ timeout: 30_000 });

    await page.setViewportSize({ width: 390, height: 844 });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    assert.equal(overflow, false);
    await page.screenshot({ path: path.join(artifacts, "fanlink-mobile.png"), fullPage: true });
    assert.equal(await page.locator('input[type="password"]').count(), 0);
  } finally {
    releaseSecond();
    await browser.close();
    await server.close();
    await created.close();
    await fixture.close();
    await removeDir(dataDir);
  }
});

test("la interfaz muestra el indicador de sesión expirada", { timeout: 30_000 }, async () => {
  await mkdir(artifacts, { recursive: true });
  const dataDir = await tempDataDir();
  const fixture = await startFixture();
  const events: string[] = [];
  const created = await createApp({
    config: testConfig(dataDir, { openLoginOnInvalidate: false }),
    site: fixture.site,
    browserFactory: recordingFactory(events),
    displayEnv: testDisplay,
  });
  const account = await created.store.create("Cuenta antigua");
  await writeFile(
    path.join(dataDir, "sessions", `${account.id}.json`),
    JSON.stringify({
      cookies: ["auth_id", "sess"].map((name) => ({
        name,
        value: "vieja",
        domain: "127.0.0.1",
        path: "/",
        expires: 1,
        httpOnly: true,
        secure: false,
        sameSite: "Lax",
      })),
      origins: [],
    }),
  );
  await created.store.update(account.id, { hasStorageState: true, status: "active" });
  await created.sessions.startup();
  const server = await listen(created.app);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  try {
    await page.goto(server.url);
    await page.locator('[data-status="expired"]').waitFor();
    assert.equal(await page.locator(".status").innerText(), "Expirada");
    await page.getByRole("button", { name: "Comprobar sesión" }).click();
    await page.locator('[data-status="expired"]').waitFor();
    assert.equal(events.length, 0);
    assert.equal(await page.locator('input[type="password"]').count(), 0);
    await page.screenshot({ path: path.join(artifacts, "fanlink-expirada.png"), fullPage: true });
  } finally {
    await browser.close();
    await server.close();
    await created.close();
    await fixture.close();
    await removeDir(dataDir);
  }
});
