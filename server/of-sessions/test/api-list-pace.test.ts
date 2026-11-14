import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { writeEncryptedSession } from "../crypto.ts";
import { createSessionRuntime } from "../runtime.ts";
import type { BrowserFactory } from "../sessions/browser-factory.ts";
import { onlyFansSite } from "../sessions/onlyfans.ts";
import type { StorageStateFile } from "../sessions/storage-state.ts";
import { apiListStep, passApiListAccounts } from "../sync/api-list-cycle.ts";
import { clearAccountChatPace, OPEN_PULL_MS, planChatPull, chatPaceOf, rememberChatPace } from "../sync/api-list-pace.ts";
import { clearAccountPauses, accountPause } from "../sync/backoff.ts";
import { clearFanSpendCache } from "../sync/fan-spend.ts";
import { fetchSignedChats } from "../sync/of-chat-api.ts";
import { clearSignRulesCache } from "../sync/of-sign.ts";
import { runInboxWatch } from "../sync/inbox-watch.ts";
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

test("veinte hilos abiertos se quedan cerca de 150 peticiones por minuto", async () => {
  clearSignRulesCache();
  clearAccountChatPace();
  clearFanSpendCache();
  let now = 1_700_000_000_000;
  let requests = 0;
  const openKeys = Array.from({ length: 20 }, (_, index) => String(index + 1));
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("dynamic-rules")) return new Response(JSON.stringify(RULES), { status: 200 });
    requests += 1;
    if (url.includes("/messages")) {
      return new Response(JSON.stringify({ list: [message("m")], hasMore: false }), { status: 200 });
    }
    return new Response(JSON.stringify({
      list: openKeys.map((id) => thread(id)),
      hasMore: false,
    }), { status: 200 });
  }) as typeof fetch;
  const end = now + 60_000;
  while (now < end) {
    const plan = planChatPull(chatPaceOf("acc-pace"), now, "all");
    if (plan.open || plan.list !== "none") {
      rememberChatPace("acc-pace", plan.next);
      await fetchSignedChats(storedState(), {
        fetch: fetchImpl,
        now: () => now,
        sleep: async (ms) => {
          now += ms;
        },
        accountId: "acc-pace",
      }, {
        openThreadKeys: plan.open ? openKeys : [],
        list: plan.list,
        messages: plan.open ? "open" : "none",
        messagePageCap: 1,
      });
    }
    now += OPEN_PULL_MS;
  }
  assert.ok(requests <= 170, `peticiones=${requests}`);
  assert.ok(requests >= 120, `peticiones=${requests}`);
  clearSignRulesCache();
  clearAccountChatPace();
});

test("la bandeja, el bucle y readChatsNow no pisan el fetch", async () => {
  clearSignRulesCache();
  clearAccountChatPace();
  clearAccountPauses();
  const dataDir = await tempDataDir();
  let clock = 1_700_000_000_000;
  let inFlight = 0;
  let maxInFlight = 0;
  const starts: number[] = [];
  let launches = 0;
  const browsers: BrowserFactory = {
    async launchPersistentContext() {
      launches += 1;
      throw new Error("chromium");
    },
    async launch() {
      launches += 1;
      throw new Error("chromium");
    },
  };
  const signedFetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("dynamic-rules")) return new Response(JSON.stringify(RULES), { status: 200 });
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    starts.push(clock);
    await new Promise((resolve) => setImmediate(resolve));
    inFlight -= 1;
    if (url.includes("offset=0")) {
      return new Response(JSON.stringify({ list: [thread("1")], hasMore: true, nextOffset: 20 }), { status: 200 });
    }
    if (url.includes("/messages")) {
      return new Response(JSON.stringify({ list: [message("m-1")], hasMore: false }), { status: 200 });
    }
    return new Response(JSON.stringify({ list: [thread("2")], hasMore: false }), { status: 200 });
  }) as typeof fetch;
  const created = await createSessionRuntime({
    config: testConfig(dataDir, { openLoginOnInvalidate: false }),
    site: onlyFansSite,
    browserFactory: browsers,
    displayEnv: testDisplay,
    fetch: signedFetch,
    now: () => new Date(clock),
    sleep: async (ms) => {
      clock += ms;
    },
  });
  try {
    const account = await created.store.create("Conectada");
    await writeEncryptedSession(
      path.join(dataDir, "sessions", `${account.id}.json`),
      storedState(),
      TEST_SESSION_KEY,
    );
    await created.store.update(account.id, { hasStorageState: true, status: "active" });
    let stop = false;
    const watch = runInboxWatch({
      stopped: () => stop,
      target: () => ({
        accountId: account.id,
        creatorId: "3zk7kbr",
        threads: [{ threadKey: "1", watchers: 1 }],
        watchers: 1,
        chatsUrl: "https://onlyfans.com/my/chats",
        siteId: "onlyfans",
      }),
      open: async () => {
        throw new Error("chromium");
      },
      save: async () => undefined,
      pullList: async (accountId, keys) => {
        await created.sessions.readPacedChats(accountId, "all", keys);
        stop = true;
        return true;
      },
      onBlock: () => 0,
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
    });
    const [, boot, sync] = await Promise.all([
      watch,
      created.sessions.readPacedChats(account.id, "list"),
      created.sessions.readCreatorChats(account.id),
    ]);
    assert.equal(boot.reason?.includes("account=") ?? false, false);
    assert.equal(sync.reason?.includes("account=") ?? false, false);
    assert.equal(maxInFlight, 1);
    assert.equal(launches, 0);
    assert.ok(starts.length >= 2, `fetches=${starts.length}`);
    for (let index = 1; index < starts.length; index += 1) {
      assert.ok(starts[index] - starts[index - 1] >= 300, `${starts[index - 1]}→${starts[index]}`);
    }
  } finally {
    clearSignRulesCache();
    clearAccountChatPace();
    clearAccountPauses();
    await created.close();
    await removeDir(dataDir);
  }
});

test("la primera lectura correcta borra el rechazo de firma", async () => {
  clearSignRulesCache();
  clearAccountChatPace();
  clearAccountPauses();
  const dataDir = await tempDataDir();
  let mode: "bad" | "ok" = "bad";
  let chatCalls = 0;
  const signedFetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("dynamic-rules")) return new Response(JSON.stringify(RULES), { status: 200 });
    chatCalls += 1;
    if (mode === "bad") return new Response("{}", { status: 400, headers: { "content-type": "application/json" } });
    return new Response(JSON.stringify({ list: [thread("1")], hasMore: false }), { status: 200 });
  }) as typeof fetch;
  const created = await createSessionRuntime({
    config: testConfig(dataDir, { openLoginOnInvalidate: false }),
    site: onlyFansSite,
    browserFactory: closedBrowser(),
    displayEnv: testDisplay,
    fetch: signedFetch,
  });
  try {
    const account = await created.store.create("Conectada");
    await writeEncryptedSession(
      path.join(dataDir, "sessions", `${account.id}.json`),
      storedState(),
      TEST_SESSION_KEY,
    );
    await created.store.update(account.id, { hasStorageState: true, status: "active" });
    const rejected = await created.sessions.readChatsDirect(account.id);
    assert.equal(rejected.signatureRejected, true);
    assert.equal((await created.store.get(account.id)).lastError, "OnlyFans rechazó la firma");
    assert.ok(accountPause(account.id));
    const duringPause = chatCalls;
    const skipped = await created.sessions.readCreatorChats(account.id);
    assert.equal(skipped.signatureRejected, true);
    assert.equal(chatCalls, duringPause);
    clearAccountPauses();
    mode = "ok";
    const ok = await created.sessions.readChatsDirect(account.id);
    assert.ok(ok.threads.length > 0);
    assert.equal((await created.store.get(account.id)).lastError, null);
    assert.equal((await created.store.get(account.id)).status, "active");
  } finally {
    clearSignRulesCache();
    clearAccountChatPace();
    clearAccountPauses();
    await created.close();
    await removeDir(dataDir);
  }
});

test("una cuenta sin archivo se lee en el ciclo siguiente a conectarse", async () => {
  clearSignRulesCache();
  clearAccountChatPace();
  clearAccountPauses();
  const dataDir = await tempDataDir();
  let chatCalls = 0;
  const signedFetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("dynamic-rules")) return new Response(JSON.stringify(RULES), { status: 200 });
    chatCalls += 1;
    return new Response(JSON.stringify({ list: [thread("1")], hasMore: false }), { status: 200 });
  }) as typeof fetch;
  const created = await createSessionRuntime({
    config: testConfig(dataDir, { openLoginOnInvalidate: false }),
    site: onlyFansSite,
    browserFactory: closedBrowser(),
    displayEnv: testDisplay,
    fetch: signedFetch,
  });
  const noted = new Set<string>();
  const lines: string[] = [];
  const log = (line: string) => {
    lines.push(line);
  };
  try {
    const account = await created.store.create("Nueva", "3zk7kbr");
    const finish = async () => undefined;
    await passApiListAccounts(created.sessions, await created.sessions.listAccounts(), noted, finish, log);
    await passApiListAccounts(created.sessions, await created.sessions.listAccounts(), noted, finish, log);
    assert.equal(chatCalls, 0);
    assert.equal(lines.filter((line) => line.includes("se omite")).length, 1);
    await writeEncryptedSession(
      path.join(dataDir, "sessions", `${account.id}.json`),
      storedState(),
      TEST_SESSION_KEY,
    );
    await created.store.update(account.id, { hasStorageState: true, status: "active", identityState: "verified" });
    let read = 0;
    await passApiListAccounts(created.sessions, await created.sessions.listAccounts(), noted, async (row, got) => {
      read += 1;
      const step = apiListStep(row, {
        threadCount: got.threads.length,
        messageCount: got.messages.length,
        reason: got.reason,
        sessionRejected: got.sessionRejected === true,
        signatureRejected: got.signatureRejected === true,
        retryAfterMs: got.retryAfterMs ?? 0,
      });
      log(step.line);
    }, log);
    assert.equal(read, 1);
    assert.ok(chatCalls >= 1);
    assert.equal(lines.some((line) => line.includes(`creator=3zk7kbr account=${account.id} hilos=`)), true);
    await created.store.update(account.id, { hasStorageState: false, status: "pending_login" });
    const before = lines.length;
    await passApiListAccounts(created.sessions, await created.sessions.listAccounts(), noted, finish, log);
    assert.equal(lines.slice(before).some((line) => line.includes("se omite")), true);
  } finally {
    clearSignRulesCache();
    clearAccountChatPace();
    clearAccountPauses();
    await created.close();
    await removeDir(dataDir);
  }
});

function closedBrowser(): BrowserFactory {
  return {
    async launchPersistentContext() {
      throw new Error("chromium");
    },
    async launch() {
      throw new Error("chromium");
    },
  };
}

function thread(id: string) {
  return {
    withUser: { id, name: `Fan ${id}` },
    lastMessage: { id: `p-${id}`, text: "previo", createdAt: "2026-11-12T00:00:00.000Z", fromUser: { id } },
    unreadMessagesCount: 0,
  };
}

function message(id: string) {
  return { id, text: "hola", createdAt: "2026-11-12T00:00:01.000Z", fromUser: { id: "fan" } };
}

function storedState(): StorageStateFile {
  return {
    cookies: [cookie("auth_id", "42"), cookie("sess", "ok")],
    origins: [{ origin: "https://onlyfans.com", localStorage: [{ name: "bcTokenSha", value: "huella" }] }],
  };
}

function cookie(name: string, value: string): StorageStateFile["cookies"][number] {
  return {
    name,
    value,
    domain: ".onlyfans.com",
    path: "/",
    expires: -1,
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
  };
}
