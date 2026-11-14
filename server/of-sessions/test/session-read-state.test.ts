import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { writeEncryptedSession } from "../crypto.ts";
import { createSessionRuntime } from "../runtime.ts";
import type { BrowserFactory } from "../sessions/browser-factory.ts";
import { onlyFansSite } from "../sessions/onlyfans.ts";
import type { StorageStateFile } from "../sessions/storage-state.ts";
import { clearAccountPauses } from "../sync/backoff.ts";
import { clearAccountChatPace } from "../sync/api-list-pace.ts";
import { clearMarkReadJobs, markOpenedChat } from "../sync/mark-read.ts";
import { clearSignRulesCache, parseSignRules } from "../sync/of-sign.ts";
import type { ReadSql } from "../sync/store.ts";
import { passApiListAccounts } from "../sync/api-list-cycle.ts";
import { SESSION_EXPIRED_LABEL } from "../sync/session-link.ts";
import { removeDir, tempDataDir, TEST_SESSION_KEY, testConfig, testDisplay } from "./helpers.ts";

const RULES = {
  static_param: "param",
  format: "1:{}:{:x}:2",
  checksum_indexes: [0, 1],
  checksum_constants: [4, 6],
  checksum_constant: 10,
  app_token: "token",
  remove_headers: ["user-id"],
};

test("una cuenta en login_required con una lectura 200 queda conectada y no abre Chromium", async () => {
  clearSignRulesCache();
  clearAccountPauses();
  const dataDir = await tempDataDir();
  let launches = 0;
  let chats = 0;
  const created = await createSessionRuntime({
    config: testConfig(dataDir, { openLoginOnInvalidate: false }),
    site: onlyFansSite,
    browserFactory: closedBrowser(() => { launches += 1; }),
    displayEnv: testDisplay,
    fetch: signedFetch(() => { chats += 1; }, 200),
  });
  try {
    const account = await created.store.create("Viva", "3zk7kbr");
    await writeEncryptedSession(path.join(dataDir, "sessions", `${account.id}.json`), storedState(), TEST_SESSION_KEY);
    await created.store.update(account.id, {
      hasStorageState: true,
      status: "active",
      connection: "login_required",
      identityState: "unavailable",
      sessionRejected: false,
    });
    const read = await created.sessions.readChatsDirect(account.id);
    assert.equal(read.sessionRejected, false);
    assert.ok((read.threads?.length ?? 0) >= 0);
    const stored = await created.sessions.getAccount(account.id);
    assert.equal(stored.connection, "live");
    assert.equal(stored.status, "active");
    assert.equal(stored.sessionRejected, false);
    assert.equal(launches, 0);
    assert.ok(chats >= 1);
  } finally {
    clearSignRulesCache();
    clearAccountPauses();
    await created.close();
    await removeDir(dataDir);
  }
});

test("un 401 marca sessionRejected sin Chromium y la lista ya no la pide", async () => {
  clearSignRulesCache();
  clearAccountPauses();
  const dataDir = await tempDataDir();
  let launches = 0;
  let chats = 0;
  const created = await createSessionRuntime({
    config: testConfig(dataDir, { openLoginOnInvalidate: false }),
    site: onlyFansSite,
    browserFactory: closedBrowser(() => { launches += 1; }),
    displayEnv: testDisplay,
    fetch: signedFetch(() => { chats += 1; }, 401),
  });
  try {
    const account = await created.store.create("Caida", "9ikis52");
    await writeEncryptedSession(path.join(dataDir, "sessions", `${account.id}.json`), storedState(), TEST_SESSION_KEY);
    await created.store.update(account.id, { hasStorageState: true, status: "active", connection: "live", sessionRejected: false });
    const read = await created.sessions.readChatsDirect(account.id);
    assert.equal(read.sessionRejected, true);
    const stored = await created.sessions.getAccount(account.id);
    assert.equal(stored.sessionRejected, true);
    assert.equal(stored.connection, "login_required");
    assert.equal(launches, 0);
    const before = chats;
    let loopCalls = 0;
    await passApiListAccounts({
      async readPacedChats() {
        loopCalls += 1;
        return read;
      },
    }, [stored], new Set(), async () => undefined);
    assert.equal(loopCalls, 0);
    assert.equal(chats, before);
    const again = await created.sessions.readOnlineFans(account.id);
    assert.equal(again.reason, SESSION_EXPIRED_LABEL);
    assert.equal(chats, before);
    assert.equal(launches, 0);
    const kept = await created.sessions.recordSignedRead(account.id, 200);
    assert.equal(kept.sessionRejected, true);
    assert.equal(kept.connection, "login_required");
  } finally {
    clearSignRulesCache();
    clearAccountPauses();
    await created.close();
    await removeDir(dataDir);
  }
});

test("un 401 en vuelo no marca la sesión después de Reconectar", async () => {
  clearSignRulesCache();
  clearAccountPauses();
  const dataDir = await tempDataDir();
  let launches = 0;
  let release = () => undefined as void;
  let entered = () => undefined as void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const started = new Promise<void>((resolve) => { entered = resolve; });
  const created = await createSessionRuntime({
    config: testConfig(dataDir, { openLoginOnInvalidate: false }),
    site: onlyFansSite,
    browserFactory: closedBrowser(() => { launches += 1; }),
    displayEnv: testDisplay,
    fetch: (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("dynamic-rules")) return Response.json(RULES);
      entered();
      await gate;
      return new Response("{}", { status: 401, headers: { "content-type": "application/json" } });
    }) as typeof fetch,
  });
  try {
    const account = await created.store.create("Carrera", "3zk7kbr");
    await writeEncryptedSession(path.join(dataDir, "sessions", `${account.id}.json`), storedState(), TEST_SESSION_KEY);
    await created.store.update(account.id, { hasStorageState: true, status: "active", connection: "live", sessionRejected: false });
    const pending = created.sessions.readChatsDirect(account.id);
    await started;
    created.sessions.rotateSessionEpoch(account.id);
    await created.store.update(account.id, { connection: "live", status: "active", sessionRejected: false });
    release();
    await pending;
    const stored = await created.sessions.getAccount(account.id);
    assert.equal(stored.sessionRejected, false);
    assert.equal(stored.connection, "live");
    assert.equal(launches, 0);
  } finally {
    release();
    clearSignRulesCache();
    clearAccountPauses();
    await created.close();
    await removeDir(dataDir);
  }
});

test("un 401 de fans no tumba la sesión si users/me sigue dentro", async () => {
  const stored = await onlineCase((url) => {
    if (url.includes("subscriptions/subscribers")) return new Response("no", { status: 401 });
    if (url.includes("/users/me")) return Response.json({ isAuth: true, id: 42, username: "creadora" });
    return new Response("no", { status: 500 });
  });
  assert.equal(stored.reason, SESSION_EXPIRED_LABEL);
  assert.equal(stored.sessionRejected, false);
  assert.equal(stored.launches, 0);
});

test("un 401 de fans se confirma con users/me de invitado", async () => {
  const stored = await onlineCase((url) => {
    if (url.includes("subscriptions/subscribers")) return new Response("no", { status: 401 });
    if (url.includes("/users/me")) return Response.json({ isAuth: false });
    return new Response("no", { status: 500 });
  });
  assert.equal(stored.reason, SESSION_EXPIRED_LABEL);
  assert.equal(stored.sessionRejected, true);
  assert.equal(stored.connection, "login_required");
  assert.equal(stored.launches, 0);
});

test("un 401 sin confirmar no repite users/me en cada lectura del panel", async () => {
  clearSignRulesCache();
  clearAccountPauses();
  const dataDir = await tempDataDir();
  let launches = 0;
  let usersMe = 0;
  let clock = 1_700_000_000_000;
  const created = await createSessionRuntime({
    config: testConfig(dataDir, { openLoginOnInvalidate: false }),
    site: onlyFansSite,
    browserFactory: closedBrowser(() => { launches += 1; }),
    displayEnv: testDisplay,
    now: () => new Date(clock),
    fetch: (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("dynamic-rules")) return Response.json(RULES);
      if (url.includes("/users/me")) {
        usersMe += 1;
        return Response.json({ isAuth: true, id: 42, username: "creadora" });
      }
      if (url.includes("subscriptions/subscribers")) return new Response("no", { status: 401 });
      return new Response("no", { status: 500 });
    }) as typeof fetch,
  });
  try {
    const account = await created.store.create("Repite", "9ikis52");
    await writeEncryptedSession(path.join(dataDir, "sessions", `${account.id}.json`), storedState(), TEST_SESSION_KEY);
    await created.store.update(account.id, { hasStorageState: true, status: "active", connection: "live", sessionRejected: false });
    const first = await created.sessions.readOnlineFans(account.id);
    const second = await created.sessions.readOnlineFans(account.id);
    assert.equal(first.reason, SESSION_EXPIRED_LABEL);
    assert.equal(second.reason, SESSION_EXPIRED_LABEL);
    assert.equal(usersMe, 1);
    assert.equal((await created.sessions.getAccount(account.id)).sessionRejected, false);
    clock += 31_000;
    await created.sessions.readOnlineFans(account.id);
    assert.equal(usersMe, 2);
    assert.equal(launches, 0);
  } finally {
    clearSignRulesCache();
    clearAccountPauses();
    await created.close();
    await removeDir(dataDir);
  }
});

test("un 401 de notificaciones que empezó antes de Reconectar no marca la sesión nueva", async () => {
  clearSignRulesCache();
  clearAccountPauses();
  const dataDir = await tempDataDir();
  let launches = 0;
  let release = () => undefined as void;
  let entered = () => undefined as void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const started = new Promise<void>((resolve) => { entered = resolve; });
  const created = await createSessionRuntime({
    config: testConfig(dataDir, { openLoginOnInvalidate: false }),
    site: onlyFansSite,
    browserFactory: closedBrowser(() => { launches += 1; }),
    displayEnv: testDisplay,
    fetch: (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("dynamic-rules")) return Response.json(RULES);
      entered();
      await gate;
      return new Response("{}", { status: 401, headers: { "content-type": "application/json" } });
    }) as typeof fetch,
  });
  try {
    const account = await created.store.create("Avisos", "3zk7kbr");
    await writeEncryptedSession(path.join(dataDir, "sessions", `${account.id}.json`), storedState(), TEST_SESSION_KEY);
    await created.store.update(account.id, { hasStorageState: true, status: "active", connection: "live", sessionRejected: false });
    const epoch = created.sessions.sessionGeneration(account.id);
    const pending = created.sessions.readNotificationsDirect(account.id);
    await started;
    created.sessions.rotateSessionEpoch(account.id);
    await created.store.update(account.id, { connection: "live", status: "active", sessionRejected: false });
    release();
    await pending;
    await created.sessions.noteApiSessionRejected(account.id, epoch);
    const stored = await created.sessions.getAccount(account.id);
    assert.equal(stored.sessionRejected, false);
    assert.equal(stored.connection, "live");
    assert.equal(launches, 0);
    await created.sessions.noteApiSessionRejected(account.id);
    assert.equal((await created.sessions.getAccount(account.id)).sessionRejected, true);
  } finally {
    release();
    clearSignRulesCache();
    clearAccountPauses();
    await created.close();
    await removeDir(dataDir);
  }
});

test("un 401 de mark-as-read que ya iba en vuelo no marca la sesión nueva", async () => {
  clearSignRulesCache();
  clearAccountPauses();
  clearAccountChatPace();
  clearMarkReadJobs();
  const dataDir = await tempDataDir();
  let launches = 0;
  let release = () => undefined as void;
  let entered = () => undefined as void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const started = new Promise<void>((resolve) => { entered = resolve; });
  const rules = parseSignRules(RULES);
  if (!rules) throw new Error("reglas");
  const created = await createSessionRuntime({
    config: testConfig(dataDir, { openLoginOnInvalidate: false }),
    site: onlyFansSite,
    browserFactory: closedBrowser(() => { launches += 1; }),
    displayEnv: testDisplay,
    fetch: (async () => new Response("{}", { status: 500 })) as typeof fetch,
  });
  try {
    const account = await created.store.create("Marca", "3zk7kbr");
    await writeEncryptedSession(path.join(dataDir, "sessions", `${account.id}.json`), storedState(), TEST_SESSION_KEY);
    await created.store.update(account.id, { hasStorageState: true, status: "active", connection: "live", sessionRejected: false });
    const epoch = created.sessions.sessionGeneration(account.id);
    const pending = markOpenedChat({
      accountId: account.id,
      creatorId: "3zk7kbr",
      threadKey: "99",
      flag: "true",
      allowlist: "3zk7kbr",
      account: { creatorId: "3zk7kbr", accountId: account.id, handle: "creadora", userId: "42", label: "Marca" },
      sql: unreadSql(),
      fetch: (async () => {
        entered();
        await gate;
        return new Response("{}", { status: 401, headers: { "content-type": "application/json" } });
      }) as typeof fetch,
      now: () => Date.now(),
      sleep: async () => undefined,
      rules,
      auth: { cookie: "auth_id=42; sess=ok", userId: "42", xBc: "huella" },
      onSessionRejected: () => created.sessions.noteApiSessionRejected(account.id, epoch),
    });
    await started;
    created.sessions.rotateSessionEpoch(account.id);
    await created.store.update(account.id, { connection: "live", status: "active", sessionRejected: false });
    release();
    await pending;
    const stored = await created.sessions.getAccount(account.id);
    assert.equal(stored.sessionRejected, false);
    assert.equal(stored.connection, "live");
    assert.equal(launches, 0);
  } finally {
    release();
    clearMarkReadJobs();
    clearAccountChatPace();
    clearAccountPauses();
    clearSignRulesCache();
    await created.close();
    await removeDir(dataDir);
  }
});

test("el margen de users/me es por cuenta y Reconectar lo borra", async () => {
  clearSignRulesCache();
  clearAccountPauses();
  const dataDir = await tempDataDir();
  let launches = 0;
  let usersMe = 0;
  let clock = 1_700_000_000_000;
  const created = await createSessionRuntime({
    config: testConfig(dataDir, { openLoginOnInvalidate: false }),
    site: onlyFansSite,
    browserFactory: closedBrowser(() => { launches += 1; }),
    displayEnv: testDisplay,
    now: () => new Date(clock),
    fetch: (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("dynamic-rules")) return Response.json(RULES);
      if (url.includes("/users/me")) {
        usersMe += 1;
        return Response.json({ isAuth: true, id: 42, username: "creadora" });
      }
      if (url.includes("subscriptions/subscribers")) return new Response("no", { status: 401 });
      return new Response("no", { status: 500 });
    }) as typeof fetch,
  });
  try {
    const first = await created.store.create("Una", "9ikis52");
    const second = await created.store.create("Otra", "3zk7kbr");
    for (const account of [first, second]) {
      await writeEncryptedSession(path.join(dataDir, "sessions", `${account.id}.json`), storedState(), TEST_SESSION_KEY);
      await created.store.update(account.id, { hasStorageState: true, status: "active", connection: "live", sessionRejected: false });
    }
    await created.sessions.readOnlineFans(first.id);
    await created.sessions.readOnlineFans(first.id);
    assert.equal(usersMe, 1);
    await created.sessions.readOnlineFans(second.id);
    await created.sessions.readOnlineFans(second.id);
    assert.equal(usersMe, 2);
    created.sessions.rotateSessionEpoch(first.id);
    await created.sessions.readOnlineFans(first.id);
    assert.equal(usersMe, 3);
    await created.sessions.readOnlineFans(second.id);
    assert.equal(usersMe, 3);
    assert.equal((await created.sessions.getAccount(first.id)).sessionRejected, false);
    assert.equal((await created.sessions.getAccount(second.id)).sessionRejected, false);
    assert.equal(launches, 0);
  } finally {
    clearSignRulesCache();
    clearAccountPauses();
    await created.close();
    await removeDir(dataDir);
  }
});

test("un 429 de fans no abre Chromium", async () => {
  const stored = await onlineCase((url) => {
    if (url.includes("subscriptions/subscribers")) return new Response("slow", { status: 429, headers: { "retry-after": "2" } });
    return new Response("no", { status: 500 });
  });
  assert.equal(stored.status, 429);
  assert.equal(stored.retryAfterMs, 2_000);
  assert.match(stored.reason ?? "", /429/);
  assert.equal(stored.sessionRejected, false);
  assert.equal(stored.launches, 0);
});

async function onlineCase(route: (url: string) => Response): Promise<{
  reason: string | null;
  status: number | null;
  retryAfterMs: number | undefined;
  sessionRejected: boolean;
  connection: string;
  launches: number;
}> {
  clearSignRulesCache();
  clearAccountPauses();
  const dataDir = await tempDataDir();
  let launches = 0;
  const created = await createSessionRuntime({
    config: testConfig(dataDir, { openLoginOnInvalidate: false }),
    site: onlyFansSite,
    browserFactory: closedBrowser(() => { launches += 1; }),
    displayEnv: testDisplay,
    fetch: (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("dynamic-rules")) return Response.json(RULES);
      return route(url);
    }) as typeof fetch,
  });
  try {
    const account = await created.store.create("Fans", "9ikis52");
    await writeEncryptedSession(path.join(dataDir, "sessions", `${account.id}.json`), storedState(), TEST_SESSION_KEY);
    await created.store.update(account.id, { hasStorageState: true, status: "active", connection: "live", sessionRejected: false });
    const read = await created.sessions.readOnlineFans(account.id);
    const stored = await created.sessions.getAccount(account.id);
    return {
      reason: read.reason,
      status: read.status,
      retryAfterMs: read.retryAfterMs,
      sessionRejected: stored.sessionRejected,
      connection: stored.connection,
      launches,
    };
  } finally {
    clearSignRulesCache();
    clearAccountPauses();
    await created.close();
    await removeDir(dataDir);
  }
}

function unreadSql(): ReadSql {
  return {
    async query<T>(text: string): Promise<T[]> {
      if (text.startsWith("select")) return [{ unread: 4 }] as T[];
      return [];
    },
  };
}

function signedFetch(count: () => void, status: number): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("dynamic-rules")) return Response.json(RULES);
    count();
    if (status === 200) {
      return Response.json({
        list: [{ withUser: { id: 7, name: "Fan" }, lastMessage: { id: "m", text: "hola", createdAt: "2026-11-12T00:00:00.000Z", fromUser: { id: 7 } }, unreadMessagesCount: 1 }],
        hasMore: false,
      });
    }
    return new Response("{}", { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

function closedBrowser(onLaunch: () => void): BrowserFactory {
  return {
    async launchPersistentContext() {
      onLaunch();
      throw new Error("chromium");
    },
    async launch() {
      onLaunch();
      throw new Error("chromium");
    },
  };
}

function storedState(): StorageStateFile {
  return {
    cookies: [
      { name: "auth_id", value: "42", domain: ".onlyfans.com", path: "/", expires: -1, httpOnly: true, secure: true, sameSite: "Lax" },
      { name: "sess", value: "ok", domain: ".onlyfans.com", path: "/", expires: -1, httpOnly: true, secure: true, sameSite: "Lax" },
    ],
    origins: [{ origin: "https://onlyfans.com", localStorage: [{ name: "bcTokenSha", value: "huella" }] }],
  };
}
