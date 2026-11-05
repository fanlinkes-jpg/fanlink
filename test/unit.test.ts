import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { messages } from "../src/messages.js";
import { assertLoginDisplay } from "../src/sessions/display.js";
import { onlyFansSite } from "../src/sessions/onlyfans.js";
import { judgeStorageState, type StorageCookie, type StorageStateFile } from "../src/sessions/storage-state.js";
import { AccountStore } from "../src/store/account-store.js";
import { listen, removeDir } from "./helpers.js";

const NOW = Date.parse("2026-11-05T12:00:00Z");

function cookie(overrides: Partial<StorageCookie> = {}): StorageCookie {
  return {
    name: "auth_id",
    value: "42",
    domain: ".onlyfans.com",
    path: "/",
    expires: -1,
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    ...overrides,
  };
}

function state(cookies: StorageCookie[]): StorageStateFile {
  return { cookies, origins: [] };
}

test("la configuración real abre una ventana visible y no lee credenciales", () => {
  const config = loadConfig({ FANLINK_HEADLESS_LOGIN: "true", PORT: "8787" }, "/tmp");
  assert.equal(config.headlessLogin, false);
  assert.equal(config.openLoginOnInvalidate, true);
  assert.equal(config.host, "127.0.0.1");
});

test("en Linux hace falta DISPLAY para la ventana de login", () => {
  assert.doesNotThrow(() => assertLoginDisplay(true, { platform: "linux" }));
  assert.doesNotThrow(() => assertLoginDisplay(false, { platform: "linux", display: ":1" }));
  assert.doesNotThrow(() => assertLoginDisplay(false, { platform: "darwin" }));
  assert.throws(() => assertLoginDisplay(false, { platform: "linux" }), /DISPLAY/);
});

test("clasifica cookies vigentes, ajenas y caducadas", () => {
  const valid = state([
    cookie(),
    cookie({ name: "sess", value: "token" }),
  ]);
  assert.equal(judgeStorageState(valid, ["auth_id", "sess"], "onlyfans.com", NOW), "valid");
  assert.equal(judgeStorageState(valid, ["auth_id", "sess"], "www.onlyfans.com", NOW), "valid");

  const foreign = state([
    cookie({ domain: "evil.example" }),
    cookie({ name: "sess", value: "token", domain: "evil.example" }),
  ]);
  assert.equal(judgeStorageState(foreign, ["auth_id", "sess"], "onlyfans.com", NOW), "expired");

  const expired = state([
    cookie({ expires: 1 }),
    cookie({ name: "sess", value: "token", expires: NOW / 1000 + 3600 }),
  ]);
  assert.equal(judgeStorageState(expired, ["auth_id", "sess"], "onlyfans.com", NOW), "expired");

  const future = state([
    cookie({ expires: NOW / 1000 + 60 }),
    cookie({ name: "sess", value: "token", expires: NOW / 1000 + 60 }),
  ]);
  assert.equal(judgeStorageState(future, ["auth_id", "sess"], "onlyfans.com", NOW), "valid");
});

test("OnlyFans distingue el dashboard del formulario y rechaza otros orígenes", () => {
  const cookies = [
    cookie(),
    cookie({ name: "sess", value: "token" }),
  ];
  assert.equal(onlyFansSite.isAuthenticated("https://onlyfans.com/", cookies, NOW), true);
  assert.equal(onlyFansSite.isAuthenticated("https://onlyfans.com/my/settings", cookies, NOW), true);
  assert.equal(onlyFansSite.isAuthenticated("https://onlyfans.com/login", cookies, NOW), false);
  assert.equal(onlyFansSite.isAuthenticated("https://onlyfans.com/", [cookie()], NOW), false);
  assert.equal(onlyFansSite.isLoginUrl("https://onlyfans.com/auth/login"), true);
  assert.equal(onlyFansSite.isLoginUrl("https://onlyfans.com/"), false);
  assert.equal(onlyFansSite.isInconclusiveUrl?.("https://onlyfans.com/cdn-cgi/challenge"), true);
  assert.doesNotThrow(() => onlyFansSite.assertRequestUrl("https://www.onlyfans.com/my/settings"));
  assert.throws(() => onlyFansSite.assertRequestUrl("https://example.com/"), { message: messages.originRejected });
  assert.throws(() => onlyFansSite.assertRequestUrl("https://user:pass@onlyfans.com/"), { message: messages.urlCredentials });
  assert.throws(() => onlyFansSite.assertRequestUrl("http://onlyfans.com/"), { message: messages.originRejected });
});

test("el almacén persiste cuentas sin rutas ni secretos", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "fanlink-store-"));
  try {
    const file = path.join(dir, "accounts.json");
    const first = new AccountStore(file);
    await first.init();
    const created = await first.create("Principal");
    await first.update(created.id, { status: "active", hasStorageState: true });
    const second = new AccountStore(file);
    await second.init();
    const loaded = await second.get(created.id);
    assert.equal(loaded.label, "Principal");
    assert.equal(loaded.status, "active");
    assert.equal(loaded.hasStorageState, true);
    const raw = await readFile(file, "utf8");
    assert.equal(raw.includes("password"), false);
    assert.equal((await stat(file)).mode & 0o777, 0o600);
  } finally {
    await removeDir(dir);
  }
});

test("la API rechaza credenciales y no abre el navegador", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "fanlink-http-"));
  let launched = false;
  const factory = {
    async launch() {
      launched = true;
      throw new Error("no");
    },
    async launchPersistentContext() {
      launched = true;
      throw new Error("no");
    },
  };
  const created = await createApp({
    config: {
      dataDir: dir,
      host: "127.0.0.1",
      port: 0,
      headlessLogin: false,
      openLoginOnInvalidate: true,
      loginTimeoutMs: 20_000,
      probeTimeoutMs: 15_000,
    },
    site: onlyFansSite,
    browserFactory: factory,
    displayEnv: { platform: "linux", display: ":1" },
  });
  const server = await listen(created.app);
  try {
    const response = await fetch(`${server.url}/api/accounts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label: "Principal", password: "no-se-guarda" }),
    });
    assert.equal(response.status, 400);
    const payload = (await response.json()) as { error: string };
    assert.match(payload.error, /no acepta credenciales/i);
    assert.equal(launched, false);
    const page = await fetch(`${server.url}/`);
    const html = await page.text();
    assert.match(html.replace(/\s+/g, " "), /no los pide ni los guarda/i);
    assert.equal(html.includes('type="password"'), false);
    const script = await (await fetch(`${server.url}/app.js`)).text();
    assert.equal(script.includes("innerHTML"), false);
    assert.equal(script.includes('type="password"'), false);
  } finally {
    await server.close();
    await created.close();
    await removeDir(dir);
  }
});

test("añadir una cuenta pide una ventana visible y no un formulario propio", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "fanlink-visible-"));
  let headless: boolean | undefined;
  const created = await createApp({
    config: loadConfig({}, dir),
    site: onlyFansSite,
    displayEnv: { platform: "linux", display: ":1" },
    browserFactory: {
      async launchPersistentContext(_dir, options) {
        headless = options.headless;
        throw new Error("detener antes de navegar");
      },
      async launch() {
        throw new Error("las peticiones no se lanzan durante el alta");
      },
    },
  });
  const server = await listen(created.app);
  try {
    const response = await fetch(`${server.url}/api/accounts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label: "Principal" }),
    });
    assert.equal(response.status, 201);
    const payload = (await response.json()) as { account: { id: string; status: string } };
    assert.equal(payload.account.status, "pending_login");
    await created.sessions.whenLoginSettled(payload.account.id);
    assert.equal(headless, false);
    const account = await created.sessions.getAccount(payload.account.id);
    assert.equal(account.status, "pending_login");
    assert.match(account.lastError ?? "", /detener antes de navegar/);
  } finally {
    await server.close();
    await created.close();
    await removeDir(dir);
  }
});

test("sin escritorio no se lanza Chromium y la cuenta sigue pendiente", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "fanlink-display-"));
  let launched = false;
  const created = await createApp({
    config: { ...loadConfig({}, dir), headlessLogin: false },
    site: onlyFansSite,
    displayEnv: { platform: "linux" },
    browserFactory: {
      async launchPersistentContext() {
        launched = true;
        throw new Error("no debería lanzarse");
      },
      async launch() {
        launched = true;
        throw new Error("no debería lanzarse");
      },
    },
  });
  try {
    const account = await created.sessions.addAccount("Principal");
    await created.sessions.whenLoginSettled(account.id);
    const stored = await created.sessions.getAccount(account.id);
    assert.equal(launched, false);
    assert.equal(stored.status, "pending_login");
    assert.match(stored.lastError ?? "", /DISPLAY/);
  } finally {
    await created.close();
    await removeDir(dir);
  }
});
