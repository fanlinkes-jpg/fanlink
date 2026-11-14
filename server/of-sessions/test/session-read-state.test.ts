import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { writeEncryptedSession } from "../crypto.ts";
import { createSessionRuntime } from "../runtime.ts";
import type { BrowserFactory } from "../sessions/browser-factory.ts";
import { onlyFansSite } from "../sessions/onlyfans.ts";
import type { StorageStateFile } from "../sessions/storage-state.ts";
import { clearAccountPauses } from "../sync/backoff.ts";
import { clearSignRulesCache } from "../sync/of-sign.ts";
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
