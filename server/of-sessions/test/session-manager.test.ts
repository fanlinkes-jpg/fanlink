import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { decryptBytes, writeEncryptedSession } from "../crypto.ts";
import { createSessionRuntime } from "../runtime.ts";
import { messages } from "../messages.ts";
import { parseStorageState } from "../sessions/storage-state.ts";
import { InvalidArgumentError, SessionInvalidError } from "../types.ts";
import { startFixture } from "./fixture-site.ts";
import {
  PASSWORD,
  completeFixtureLogin,
  recordingFactory,
  removeDir,
  tempDataDir,
  TEST_SESSION_KEY,
  testConfig,
  testDisplay,
  waitFor,
} from "./helpers.ts";

test(
  "el login manual exporta el storage state y las peticiones lo restauran",
  { timeout: 60_000 },
  async () => {
    const dataDir = await tempDataDir();
    const fixture = await startFixture();
    const events: string[] = [];
    const created = await createSessionRuntime({
      config: testConfig(dataDir),
      site: fixture.site,
      browserFactory: recordingFactory(events),
      displayEnv: testDisplay,
      afterLoginPageOpen: (page) => completeFixtureLogin(page),
    });
    try {
      const first = await created.sessions.addAccount("Principal");
      await created.sessions.whenLoginSettled(first.id);
      const second = await created.sessions.addAccount("Secundaria");
      await created.sessions.whenLoginSettled(second.id);

      const profiles = await readdir(path.join(dataDir, "profiles"));
      assert.deepEqual(profiles.sort(), [first.id, second.id].sort());
      for (const id of [first.id, second.id]) {
        const account = await created.sessions.getAccount(id);
        assert.equal(account.status, "active");
        assert.equal(account.hasStorageState, true);
        const storagePath = path.join(dataDir, "sessions", `${id}.json`);
        const profilePath = path.join(dataDir, "profiles", id);
        assert.equal((await stat(storagePath)).mode & 0o777, 0o600);
        assert.equal((await stat(profilePath)).mode & 0o777, 0o700);
        assert.ok((await readdir(profilePath)).length > 0);
        const raw = await readFile(storagePath);
        assert.equal(raw.includes(PASSWORD), false);
        assert.equal(raw.subarray(0, 4).toString("utf8"), "FLS1");
        assert.throws(() => JSON.parse(raw.toString("utf8")));
        const parsed = parseStorageState(
          JSON.parse(
            decryptBytes(raw, TEST_SESSION_KEY).toString("utf8"),
          ) as unknown,
        );
        assert.ok(
          parsed.cookies.some(
            (cookie) =>
              cookie.name === "sess" && cookie.value.startsWith("ok-"),
          ),
        );
        assert.ok(
          parsed.cookies.some(
            (cookie) => cookie.name === "auth_id" && cookie.value === "42",
          ),
        );
        const origin = parsed.origins.find(
          (entry) => entry.origin === fixture.origin,
        );
        assert.equal(
          origin?.localStorage.find((item) => item.name === "fanlink_user")
            ?.value,
          "42",
        );
      }
      assert.equal(
        (await readFile(path.join(dataDir, "accounts.json"), "utf8")).includes(
          PASSWORD,
        ),
        false,
      );
      assert.equal(fixture.hits.session, 2);

      const sessionPosts = fixture.hits.session;
      const restored = await created.sessions.withSession(
        first.id,
        async (context) => {
          const page = await context.newPage();
          await page.goto(`${fixture.origin}/blank`);
          return page.evaluate(() => localStorage.getItem("fanlink_user"));
        },
      );
      assert.equal(restored, "42");

      const response = await created.sessions.sessionFetch(
        first.id,
        fixture.site.probeUrl,
      );
      assert.equal(response.status, 200);
      assert.match(response.finalUrl, /\/dashboard$/);
      assert.match(response.body, /Dashboard/);
      assert.equal(fixture.hits.session, sessionPosts);
      assert.equal(
        events.filter((event) => event.startsWith("persistent:false:")).length,
        0,
      );
      assert.equal(
        events.filter((event) => event.startsWith("persistent:true:")).length,
        2,
      );
      assert.equal(events.filter((event) => event === "launch").length, 1);
      assert.equal(
        events.filter((event) => event.startsWith("context:")).length,
        2,
      );

      await assert.rejects(
        () =>
          created.sessions.sessionFetch(
            first.id,
            "https://example.com/private",
          ),
        (error: unknown) => error instanceof InvalidArgumentError,
      );
      assert.equal(
        (await created.sessions.getAccount(first.id)).status,
        "active",
      );
    } finally {
      await created.close();
      await fixture.close();
      await removeDir(dataDir);
    }
  },
);

test(
  "al arrancar se restaura la sesión sin volver a entrar",
  { timeout: 60_000 },
  async () => {
    const dataDir = await tempDataDir();
    const fixture = await startFixture();
    const login = await createSessionRuntime({
      config: testConfig(dataDir),
      site: fixture.site,
      browserFactory: recordingFactory([]),
      displayEnv: testDisplay,
      afterLoginPageOpen: (page) => completeFixtureLogin(page),
    });
    const account = await login.sessions.addAccount("Principal");
    await login.sessions.whenLoginSettled(account.id);
    await login.close();
    const postsAfterLogin = fixture.hits.session;

    const events: string[] = [];
    const restarted = await createSessionRuntime({
      config: testConfig(dataDir),
      site: fixture.site,
      browserFactory: recordingFactory(events),
      displayEnv: testDisplay,
      afterLoginPageOpen: () => {
        throw new Error("no hay que volver a pedir credenciales");
      },
    });
    try {
      await restarted.sessions.startup();
      const stored = await restarted.sessions.getAccount(account.id);
      assert.equal(stored.status, "active");
      assert.equal(stored.sessionRejected, false);
      assert.equal(fixture.hits.session, postsAfterLogin);
      assert.equal(
        events.some((event) => event.startsWith("persistent:")),
        false,
      );
      assert.equal(
        events.filter((event) => event.startsWith("context:")).length,
        1,
      );
    } finally {
      await restarted.close();
      await fixture.close();
      await removeDir(dataDir);
    }
  },
);

test(
  "si el sitio invalida la sesión, pasa a pendiente y reabre la ventana",
  { timeout: 60_000 },
  async () => {
    const dataDir = await tempDataDir();
    const fixture = await startFixture();
    let logins = 0;
    let releaseSecond = (): void => undefined;
    const secondLogin = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });
    const events: string[] = [];
    const created = await createSessionRuntime({
      config: testConfig(dataDir),
      site: fixture.site,
      browserFactory: recordingFactory(events),
      displayEnv: testDisplay,
      afterLoginPageOpen: async (page) => {
        logins += 1;
        if (logins > 1) await secondLogin;
        await completeFixtureLogin(page);
      },
    });
    try {
      const account = await created.sessions.addAccount("Principal");
      await created.sessions.whenLoginSettled(account.id);
      assert.equal(
        (await created.sessions.getAccount(account.id)).status,
        "active",
      );
      fixture.invalidate();
      await assert.rejects(
        () => created.sessions.sessionFetch(account.id, fixture.site.probeUrl),
        (error: unknown) => error instanceof SessionInvalidError,
      );
      await waitFor(
        async () =>
          (await created.sessions.getAccount(account.id)).loginInProgress,
      );
      await waitFor(
        () =>
          events.filter((event) => event.startsWith("persistent:true:"))
            .length === 2,
      );
      const pending = await created.sessions.getAccount(account.id);
      assert.equal(pending.status, "pending_login");
      assert.equal(pending.sessionRejected, true);
      releaseSecond();
      await created.sessions.whenLoginSettled(account.id);
      const restored = await created.sessions.getAccount(account.id);
      assert.equal(restored.status, "active");
      assert.equal(restored.sessionRejected, false);
      assert.equal(logins, 2);
      const again = await created.sessions.sessionFetch(
        account.id,
        fixture.site.probeUrl,
      );
      assert.match(again.finalUrl, /\/dashboard$/);
    } finally {
      releaseSecond();
      await created.close();
      await fixture.close();
      await removeDir(dataDir);
    }
  },
);

test(
  "una cookie caducada queda expirada si no se reabre el login",
  { timeout: 30_000 },
  async () => {
    const dataDir = await tempDataDir();
    const fixture = await startFixture();
    const events: string[] = [];
    const created = await createSessionRuntime({
      config: testConfig(dataDir, { openLoginOnInvalidate: false }),
      site: fixture.site,
      browserFactory: recordingFactory(events),
      displayEnv: testDisplay,
    });
    try {
      const account = await created.store.create("Vieja");
      await writeEncryptedSession(
        path.join(dataDir, "sessions", `${account.id}.json`),
        {
          cookies: [
            {
              name: "auth_id",
              value: "42",
              domain: "127.0.0.1",
              path: "/",
              expires: 1,
              httpOnly: false,
              secure: false,
              sameSite: "Lax",
            },
            {
              name: "sess",
              value: "ok-1",
              domain: "127.0.0.1",
              path: "/",
              expires: 1,
              httpOnly: true,
              secure: false,
              sameSite: "Lax",
            },
          ],
          origins: [],
        },
        TEST_SESSION_KEY,
      );
      await created.store.update(account.id, {
        hasStorageState: true,
        status: "active",
      });
      await created.sessions.startup();
      const stored = await created.sessions.getAccount(account.id);
      assert.equal(stored.status, "expired");
      assert.match(stored.lastError ?? "", /caducado/);
      assert.equal(events.length, 0);
      const listed = await created.sessions.listAccounts();
      assert.equal(listed[0]?.status, "expired");
      assert.equal(events.length, 0);
    } finally {
      await created.close();
      await fixture.close();
      await removeDir(dataDir);
    }
  },
);

test(
  "una cookie caducada reabre el login y el indicador pasa a pendiente",
  { timeout: 60_000 },
  async () => {
    const dataDir = await tempDataDir();
    const fixture = await startFixture();
    const events: string[] = [];
    const created = await createSessionRuntime({
      config: testConfig(dataDir, { openLoginOnInvalidate: true }),
      site: fixture.site,
      browserFactory: recordingFactory(events),
      displayEnv: testDisplay,
      afterLoginPageOpen: (page) => completeFixtureLogin(page),
    });
    try {
      const account = await created.store.create("Vieja");
      await writeEncryptedSession(
        path.join(dataDir, "sessions", `${account.id}.json`),
        {
          cookies: ["auth_id", "sess"].map((name) => ({
            name,
            value: name === "auth_id" ? "42" : "ok-1",
            domain: "127.0.0.1",
            path: "/",
            expires: 1,
            httpOnly: true,
            secure: false,
            sameSite: "Lax" as const,
          })),
          origins: [],
        },
        TEST_SESSION_KEY,
      );
      await created.store.update(account.id, {
        hasStorageState: true,
        status: "active",
      });
      const startup = created.sessions.startup();
      await waitFor(
        async () =>
          (await created.sessions.getAccount(account.id)).status ===
          "pending_login",
      );
      await startup;
      await created.sessions.whenLoginSettled(account.id);
      const stored = await created.sessions.getAccount(account.id);
      assert.equal(stored.status, "active");
      assert.equal(
        events.filter((event) => event.startsWith("persistent:true:")).length,
        1,
      );
    } finally {
      await created.close();
      await fixture.close();
      await removeDir(dataDir);
    }
  },
);

test(
  "cerrar la ventana antes del dashboard deja la cuenta pendiente",
  { timeout: 30_000 },
  async () => {
    const dataDir = await tempDataDir();
    const fixture = await startFixture();
    const created = await createSessionRuntime({
      config: testConfig(dataDir, { loginTimeoutMs: 5_000 }),
      site: fixture.site,
      browserFactory: recordingFactory([]),
      displayEnv: testDisplay,
      afterLoginPageOpen: async (page) => {
        await page.close();
      },
    });
    try {
      const account = await created.sessions.addAccount("Principal");
      await created.sessions.whenLoginSettled(account.id);
      const stored = await created.sessions.getAccount(account.id);
      assert.equal(stored.status, "pending_login");
      assert.equal(stored.hasStorageState, false);
      assert.match(stored.lastError ?? "", new RegExp(messages.loginClosed));
    } finally {
      await created.close();
      await fixture.close();
      await removeDir(dataDir);
    }
  },
);

test(
  "si nadie completa el acceso, el tiempo de espera no guarda una sesión",
  { timeout: 30_000 },
  async () => {
    const dataDir = await tempDataDir();
    const fixture = await startFixture();
    const created = await createSessionRuntime({
      config: testConfig(dataDir, { loginTimeoutMs: 1_200 }),
      site: fixture.site,
      browserFactory: recordingFactory([]),
      displayEnv: testDisplay,
    });
    try {
      const account = await created.sessions.addAccount("Principal");
      await created.sessions.whenLoginSettled(account.id);
      const stored = await created.sessions.getAccount(account.id);
      assert.equal(stored.status, "pending_login");
      assert.equal(stored.hasStorageState, false);
      assert.equal(stored.lastError, messages.loginTimeout);
      assert.equal(fixture.hits.session, 0);
    } finally {
      await created.close();
      await fixture.close();
      await removeDir(dataDir);
    }
  },
);

test(
  "la ventana visible también completa el acceso cuando hay escritorio",
  { timeout: 60_000 },
  async (t) => {
    if (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
      t.skip("sin escritorio gráfico");
      return;
    }
    const dataDir = await tempDataDir();
    const fixture = await startFixture();
    const events: string[] = [];
    const created = await createSessionRuntime({
      config: testConfig(dataDir, { headlessLogin: false }),
      site: fixture.site,
      browserFactory: recordingFactory(events),
      displayEnv: {
        platform: "linux",
        display: process.env.DISPLAY,
        wayland: process.env.WAYLAND_DISPLAY,
      },
      afterLoginPageOpen: (page) => completeFixtureLogin(page),
    });
    try {
      const account = await created.sessions.addAccount("Visible");
      await created.sessions.whenLoginSettled(account.id);
      assert.equal(
        (await created.sessions.getAccount(account.id)).status,
        "active",
      );
      assert.equal(
        events.some((event) => event.startsWith("persistent:false:")),
        true,
      );
    } finally {
      await created.close();
      await fixture.close();
      await removeDir(dataDir);
    }
  },
);
