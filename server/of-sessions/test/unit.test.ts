import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { loadConfig, loadCrmSessionConfig } from "../config.ts";
import { beginCreatorLogin } from "../connect.ts";
import { decryptBytes, encryptBytes, SessionCryptoError } from "../crypto.ts";
import { messages } from "../messages.ts";
import { assertLoginDisplay } from "../sessions/display.ts";
import { onlyFansSite } from "../sessions/onlyfans.ts";
import type { BrowserFactory } from "../sessions/browser-factory.ts";
import {
  judgeStorageState,
  type StorageCookie,
  type StorageStateFile,
} from "../sessions/storage-state.ts";
import { createSessionRuntime } from "../runtime.ts";
import { sessionActionLabel, SESSION_STATUS_LABEL } from "../status.ts";
import { AccountStore } from "../store/account-store.ts";
import { DbAccountStore } from "../store/db-account-store.ts";
import { createMirroringStore } from "../store/mirroring-store.ts";
import {
  removeDir,
  TEST_SESSION_KEY,
  testConfig,
  testDisplay,
} from "./helpers.ts";

const NOW = Date.parse("2026-11-05T12:00:00Z");
const MIGRATION = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../migrations/0003_of_sessions.sql",
);

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

function rejectingFactory(flag: { launched: boolean }): BrowserFactory {
  return {
    async launch() {
      flag.launched = true;
      throw new Error("no");
    },
    async launchPersistentContext() {
      flag.launched = true;
      throw new Error("no");
    },
  };
}

test("la configuración real abre una ventana visible y no lee credenciales", () => {
  const config = loadConfig(
    { FANLINK_HEADLESS_LOGIN: "true", PORT: "8787" },
    "/tmp",
  );
  assert.equal(config.headlessLogin, false);
  assert.equal(config.headlessWork, true);
  assert.equal(loadConfig({ FANLINK_HEADFUL: "true", PORT: "8787" }, "/tmp").headlessWork, true);
  assert.equal(config.openLoginOnInvalidate, true);
  assert.equal(config.host, "127.0.0.1");
  assert.equal(config.sessionKey, null);
});

test("el CRM no reabre la ventana salvo que se pida", () => {
  const config = loadCrmSessionConfig({ PORT: "8080" }, "/tmp");
  assert.equal(config.headlessLogin, false);
  assert.equal(config.headlessWork, true);
  assert.equal(config.openLoginOnInvalidate, false);
  const enabled = loadCrmSessionConfig(
    {
      PORT: "8080",
      FANLINK_OPEN_LOGIN_ON_INVALIDATE: "true",
      FANLINK_SESSION_KEY: TEST_SESSION_KEY.toString("base64"),
    },
    "/tmp",
  );
  assert.equal(enabled.openLoginOnInvalidate, true);
  assert.equal(enabled.sessionKey?.equals(TEST_SESSION_KEY), true);
  assert.throws(
    () => loadConfig({ FANLINK_SESSION_KEY: "corta", PORT: "8080" }, "/tmp"),
    SessionCryptoError,
  );
});

test("en Linux hace falta DISPLAY para la ventana de login", () => {
  assert.doesNotThrow(() => assertLoginDisplay(true, { platform: "linux" }));
  assert.doesNotThrow(() =>
    assertLoginDisplay(false, { platform: "linux", display: ":1" }),
  );
  assert.doesNotThrow(() => assertLoginDisplay(false, { platform: "darwin" }));
  assert.throws(
    () => assertLoginDisplay(false, { platform: "linux" }),
    /DISPLAY/,
  );
});

test("clasifica cookies vigentes, ajenas y caducadas", () => {
  const valid = state([cookie(), cookie({ name: "sess", value: "token" })]);
  assert.equal(
    judgeStorageState(valid, ["auth_id", "sess"], "onlyfans.com", NOW),
    "valid",
  );
  assert.equal(
    judgeStorageState(valid, ["auth_id", "sess"], "www.onlyfans.com", NOW),
    "valid",
  );

  const foreign = state([
    cookie({ domain: "evil.example" }),
    cookie({ name: "sess", value: "token", domain: "evil.example" }),
  ]);
  assert.equal(
    judgeStorageState(foreign, ["auth_id", "sess"], "onlyfans.com", NOW),
    "expired",
  );

  const expired = state([
    cookie({ expires: 1 }),
    cookie({ name: "sess", value: "token", expires: NOW / 1000 + 3600 }),
  ]);
  assert.equal(
    judgeStorageState(expired, ["auth_id", "sess"], "onlyfans.com", NOW),
    "expired",
  );
});

test("OnlyFans distingue el dashboard del formulario y rechaza otros orígenes", () => {
  const cookies = [cookie(), cookie({ name: "sess", value: "token" })];
  assert.equal(
    onlyFansSite.isAuthenticated("https://onlyfans.com/", cookies, NOW),
    true,
  );
  assert.equal(
    onlyFansSite.isAuthenticated(
      "https://onlyfans.com/my/settings",
      cookies,
      NOW,
    ),
    true,
  );
  assert.equal(
    onlyFansSite.isAuthenticated("https://onlyfans.com/login", cookies, NOW),
    false,
  );
  assert.equal(
    onlyFansSite.isLoginUrl("https://onlyfans.com/auth/login"),
    true,
  );
  assert.equal(
    onlyFansSite.isInconclusiveUrl?.("https://onlyfans.com/cdn-cgi/challenge"),
    true,
  );
  assert.doesNotThrow(() =>
    onlyFansSite.assertRequestUrl("https://www.onlyfans.com/my/settings"),
  );
  assert.throws(() => onlyFansSite.assertRequestUrl("https://example.com/"), {
    message: messages.originRejected,
  });
  assert.throws(
    () => onlyFansSite.assertRequestUrl("https://user:pass@onlyfans.com/"),
    {
      message: messages.urlCredentials,
    },
  );
});

test("el cifrado no deja las cookies en claro", () => {
  const secret = "cookie-value-sentinela-9f3c";
  const payload = encryptBytes(
    Buffer.from(JSON.stringify({ cookies: [{ value: secret }] })),
    TEST_SESSION_KEY,
  );
  assert.equal(payload.subarray(0, 4).toString("utf8"), "FLS1");
  assert.equal(payload.includes(secret), false);
  assert.equal(
    JSON.parse(decryptBytes(payload, TEST_SESSION_KEY).toString("utf8"))
      .cookies[0].value,
    secret,
  );
  assert.throws(
    () => decryptBytes(payload, Buffer.alloc(32, 9)),
    SessionCryptoError,
  );
  assert.equal(SESSION_STATUS_LABEL.active, "Activa");
  assert.equal(SESSION_STATUS_LABEL.pending_login, "Pendiente de login");
  assert.equal(SESSION_STATUS_LABEL.expired, "Expirada");
  assert.equal(sessionActionLabel("pending_login"), "Conectar");
  assert.equal(sessionActionLabel("expired"), "Reconectar");
  assert.equal(sessionActionLabel("active"), "Reconectar");
});

test("el almacén persiste la creadora sin rutas ni secretos", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "fanlink-store-"));
  try {
    const file = path.join(dir, "accounts.json");
    const first = new AccountStore(file);
    await first.init();
    const created = await first.create("Principal", "c-alba");
    await first.update(created.id, { status: "active", hasStorageState: true });
    await assert.rejects(
      () => first.create("Otra", "c-alba"),
      /ya tiene una sesión/,
    );
    const second = new AccountStore(file);
    await second.init();
    const loaded = await second.findByCreator("c-alba");
    assert.equal(loaded?.label, "Principal");
    assert.equal(loaded?.status, "active");
    assert.equal(loaded?.id, created.id);
    const raw = await readFile(file, "utf8");
    assert.equal(raw.includes("password"), false);
    assert.equal((await stat(file)).mode & 0o777, 0o600);
  } finally {
    await removeDir(dir);
  }
});

test("la tabla liga cada sesión a una creadora y el archivo se puede reconstruir", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "fanlink-db-"));
  const pg = new PGlite();
  try {
    await pg.exec(await readFile(MIGRATION, "utf8"));
    await pg.exec(await readFile(path.resolve(path.dirname(MIGRATION), "0004_staff_and_connection.sql"), "utf8"));
    await pg.exec(await readFile(path.resolve(path.dirname(MIGRATION), "0005_identity_fields.sql"), "utf8"));
    await pg.exec(await readFile(path.resolve(path.dirname(MIGRATION), "0006_identity_reason.sql"), "utf8"));
    const sql = {
      query: async <T>(text: string, params: unknown[] = []) =>
        (await pg.query<T>(text, params)).rows,
    };
    const db = new DbAccountStore(sql);
    const mirror = createMirroringStore(
      new AccountStore(path.join(dir, "accounts.json")),
      db,
    );
    await mirror.init();
    const created = await mirror.create("Alba", "c-alba");
    await mirror.update(created.id, {
      status: "active",
      hasStorageState: true,
    });
    await assert.rejects(
      () => db.create("Otra", "c-alba"),
      /ya tiene una sesión/,
    );

    const linked = await new DbAccountStore(sql).findByCreator("c-alba");
    assert.equal(linked?.id, created.id);
    assert.equal(linked?.status, "active");

    const restored = createMirroringStore(
      new AccountStore(path.join(dir, "restored.json")),
      new DbAccountStore(sql),
    );
    await restored.init();
    assert.equal((await restored.findByCreator("c-alba"))?.label, "Alba");
  } finally {
    await pg.close();
    await removeDir(dir);
  }
});

test("conectar rechaza credenciales y no abre el navegador", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "fanlink-cred-"));
  const flag = { launched: false };
  const created = await createSessionRuntime({
    config: testConfig(dir),
    site: onlyFansSite,
    browserFactory: rejectingFactory(flag),
    displayEnv: testDisplay,
  });
  try {
    await assert.rejects(
      () =>
        beginCreatorLogin(created.sessions, {
          creatorId: "c-alba",
          label: "Alba",
          password: "no-se-guarda",
        }),
      (error: unknown) =>
        error instanceof Error && /no acepta credenciales/i.test(error.message),
    );
    assert.equal(flag.launched, false);
    assert.equal((await created.store.list()).length, 0);
  } finally {
    await created.close();
    await removeDir(dir);
  }
});

test("conectar pide una ventana visible y liga la creadora", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "fanlink-visible-"));
  let headless: boolean | undefined;
  const created = await createSessionRuntime({
    config: loadCrmSessionConfig(
      {
        PORT: "0",
        FANLINK_DATA_DIR: dir,
        FANLINK_SESSION_KEY: TEST_SESSION_KEY.toString("base64"),
      },
      dir,
    ),
    site: onlyFansSite,
    displayEnv: testDisplay,
    browserFactory: {
      async launchPersistentContext(_userDataDir, options) {
        headless = options.headless;
        throw new Error("detener antes de navegar");
      },
      async launch() {
        throw new Error("las peticiones no se lanzan durante el alta");
      },
    },
  });
  try {
    const account = await beginCreatorLogin(created.sessions, {
      creatorId: "c-alba",
      label: "Alba",
      platform: "OnlyFans",
    });
    await created.sessions.whenLoginSettled(account.id);
    assert.equal(headless, false);
    const stored = await created.sessions.getAccount(account.id);
    assert.equal(stored.creatorId, "c-alba");
    assert.equal(stored.status, "pending_login");
    assert.match(stored.lastError ?? "", /detener antes de navegar/);
    await assert.rejects(
      () =>
        beginCreatorLogin(created.sessions, {
          creatorId: "c-alba",
          label: "Alba",
          platform: "Fansly",
        }),
      /solo conecta cuentas de OnlyFans/,
    );
  } finally {
    await created.close();
    await removeDir(dir);
  }
});

test("sin escritorio no se lanza Chromium y la cuenta sigue pendiente", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "fanlink-display-"));
  const flag = { launched: false };
  const created = await createSessionRuntime({
    config: testConfig(dir, { headlessLogin: false }),
    site: onlyFansSite,
    displayEnv: { platform: "linux" },
    browserFactory: rejectingFactory(flag),
  });
  try {
    const account = await created.sessions.addAccount("Principal");
    await created.sessions.whenLoginSettled(account.id);
    const stored = await created.sessions.getAccount(account.id);
    assert.equal(flag.launched, false);
    assert.equal(stored.status, "pending_login");
    assert.match(stored.lastError ?? "", /DISPLAY/);
  } finally {
    await created.close();
    await removeDir(dir);
  }
});

test("sin clave y sin escritorio no se lanza Chromium", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "fanlink-key-"));
  const flag = { launched: false };
  const created = await createSessionRuntime({
    config: testConfig(dir, { sessionKey: null, headlessLogin: false }),
    site: onlyFansSite,
    displayEnv: { platform: "linux" },
    browserFactory: rejectingFactory(flag),
  });
  try {
    const account = await created.sessions.addAccount("Principal");
    await created.sessions.whenLoginSettled(account.id);
    const stored = await created.sessions.getAccount(account.id);
    assert.equal(flag.launched, false);
    assert.equal(stored.status, "pending_login");
    assert.match(stored.lastError ?? "", /FANLINK_SESSION_KEY/);
  } finally {
    await created.close();
    await removeDir(dir);
  }
});

test("la interfaz no pide la contraseña ni cicla un estado falso", async () => {
  const root = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../..",
  );
  const conectar = await readFile(
    path.join(root, "src/routes/conectar.tsx"),
    "utf8",
  );
  const creadoras = await readFile(
    path.join(root, "src/features/control-pages.tsx"),
    "utf8",
  );
  const api = await readFile(path.join(root, "src/lib/of-sessions.ts"), "utf8");
  assert.equal(conectar.includes('type="password"'), false);
  assert.equal(conectar.includes("cycleSession"), false);
  assert.equal(creadoras.includes("cycleSession"), false);
  assert.match(api, /authMiddleware/);
  assert.match(conectar, /no pide ni guarda la contraseña/);
  assert.match(creadoras, /Pendiente de login/);
});
