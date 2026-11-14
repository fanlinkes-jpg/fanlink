import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import type { Page } from "playwright";
import { writeEncryptedSession } from "../crypto.ts";
import { createSessionRuntime } from "../runtime.ts";
import { onlyFansSite } from "../sessions/onlyfans.ts";
import type { StorageStateFile } from "../sessions/storage-state.ts";
import { clearSignRulesCache, parseSignRules, RULES_TIMEOUT_MS } from "../sync/of-sign.ts";
import { TEST_SESSION_KEY, removeDir, tempDataDir, testConfig, testDisplay } from "./helpers.ts";
import {
  ONLINE_COLLECTION_URLS,
  ONLINE_SUBSCRIBERS_PATH,
  fetchSignedOnlineFans,
  onlineFansFromPayload,
  mergeOnlineAccounts,
  onlineReadFromPayload,
  readOnlineSubscribers,
  subscribersResponse,
} from "../sync/online-fans.ts";
import { SESSION_EXPIRED_LABEL } from "../sync/session-link.ts";

test("el filtro en línea se reconoce y solo entran los que están conectados", () => {
  assert.equal(subscribersResponse("https://onlyfans.com/api2/v2/subscriptions/subscribers?type=active&filter[online]=1"), "online");
  assert.equal(subscribersResponse("https://onlyfans.com/api2/v2/subscriptions/subscribers?offset=0"), "all");
  assert.equal(subscribersResponse("https://onlyfans.com/api2/v2/chats"), null);
  const rows = onlineFansFromPayload({
    list: [
      { id: 1, name: "Arias Crazy", username: "arias_crazy1", isOnline: true, avatar: "https://cdn.example/a.jpg" },
      { id: 2, name: "Otro", username: "otro", isOnline: false },
    ],
  });
  assert.deepEqual(rows, [{ fanKey: "1", fanName: "Arias Crazy", fanHandle: "arias_crazy1", avatarUrl: "https://cdn.example/a.jpg", spentCents: null, currency: null, online: true, lists: [] }]);
  const rich = onlineFansFromPayload({
    list: [{
      id: 5,
      name: "Didi",
      username: "didi",
      isOnline: true,
      totalSumm: 9.6,
      avatarThumbs: { c50: "https://cdn.example/d.jpg" },
      listsStates: [{ name: "VIP", hasUser: true }, { name: "Muted", hasUser: false }],
    }, { id: 6, username: "sin", isOnline: true }],
  });
  assert.equal(rich[0]?.spentCents, 960);
  assert.equal(rich[0]?.avatarUrl, "https://cdn.example/d.jpg");
  assert.deepEqual(rich[0]?.lists, ["VIP"]);
  assert.equal(rich[1]?.spentCents, null);
  assert.equal(onlineFansFromPayload({ list: [{ id: 9, username: "duchamp", isOnline: false }] }, false).length, 0);
  assert.equal(onlineFansFromPayload({ list: [{ id: 10, username: "sinmarca", currency: "EUR", totalSumm: 4.8 }] }, false)[0]?.currency, "EUR");
  const nested = onlineReadFromPayload(200, {
    data: {
      list: [
        { id: 3, username: "duchampprivate", name: "Duchamp", isOnline: true },
        { id: 4, username: "brendaoff", isOnline: false },
      ],
    },
  });
  assert.equal(nested.reason, null);
  assert.deepEqual(nested.fans.map((fan) => fan.fanHandle), ["duchampprivate"]);
  assert.equal(onlineReadFromPayload(200, { data: { list: [] } }).reason, "Nadie en línea");
  assert.equal(onlineReadFromPayload(200, { ok: true }).reason, "No se pudo leer.");
  assert.equal(onlineReadFromPayload(401, { list: [] }).reason, SESSION_EXPIRED_LABEL);
  assert.equal(onlineReadFromPayload(401, { list: [] }).sessionRejected, true);
  assert.equal(onlineReadFromPayload(400, { list: [] }).reason, "OnlyFans ha rechazado la firma");
  assert.equal(onlineReadFromPayload(400, { list: [] }).signatureRejected, true);
  assert.notEqual(onlineReadFromPayload(401, { list: [] }).reason, onlineReadFromPayload(400, { list: [] }).reason);
});

test("api2 firmada cuenta la lista filtrada, el 401 es la sesión y el 200 vacío no es un fallo", async () => {
  const rules = parseSignRules({
    static_param: "param",
    format: "1:{}:{:x}:2",
    checksum_indexes: [0, 1],
    checksum_constant: 10,
    app_token: "token",
  });
  assert.ok(rules);
  const state = sessionState();
  const two = await fetchSignedOnlineFans(state, {
    now: () => 1_700_000_000_000,
    rules,
    fetch: async (input, init) => {
      assert.equal(String(input), `https://onlyfans.com${ONLINE_SUBSCRIBERS_PATH}`);
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("user-id"), "42");
      assert.equal(headers.get("time"), "1700000000000");
      assert.equal(headers.get("sign")?.includes("sess"), false);
      return Response.json({
        data: {
          list: [
            { id: 7, username: "duchampprivate", isOnline: true },
            { id: 8, username: "brendababypremium", isOnline: false },
            { id: 9, username: "sinmarca" },
          ],
        },
      });
    },
  });
  assert.equal(two.status, 200);
  assert.equal(two.reason, null);
  assert.deepEqual(two.fans.map((fan) => fan.fanHandle), ["duchampprivate", "sinmarca"]);

  const denied = await fetchSignedOnlineFans(state, {
    now: () => 1,
    rules,
    fetch: async () => new Response("no", { status: 401 }),
  });
  assert.equal(denied.reason, SESSION_EXPIRED_LABEL);
  assert.equal(denied.sessionRejected, true);
  assert.equal(denied.fans.length, 0);
  assert.equal(denied.status, 401);
  const signature = await fetchSignedOnlineFans(state, {
    now: () => 1,
    rules,
    fetch: async () => new Response("no", { status: 400 }),
  });
  assert.equal(signature.reason, "OnlyFans ha rechazado la firma");
  assert.equal(signature.signatureRejected, true);
  assert.equal(signature.sessionRejected, undefined);

  const empty = await fetchSignedOnlineFans(state, {
    now: () => 1,
    rules,
    fetch: async () => Response.json({ list: [] }),
  });
  assert.equal(empty.reason, "Nadie en línea");
  assert.equal(empty.fans.length, 0);

  const broken = await fetchSignedOnlineFans(state, {
    now: () => 1,
    rules,
    fetch: async () => new Response("no-json", { status: 200, headers: { "content-type": "text/plain" } }),
  });
  assert.equal(broken.reason, "No se pudo leer.");

  const unmarked = onlineReadFromPayload(200, {
    list: [
      { id: 21, username: "duchampprivate", name: "Duchamp" },
      { id: 22, username: "brendababypremium" },
    ],
  });
  assert.equal(unmarked.status, 200);
  assert.equal(unmarked.reason, null);
  assert.equal(unmarked.fans.length, 2);
});

test("en todas las cuentas un 401 no esconde los fans del 200", () => {
  const merged = mergeOnlineAccounts([
    { creatorId: "9ikis52", fans: [], reason: SESSION_EXPIRED_LABEL, status: 401 },
    {
      creatorId: "3zk7kbr",
      fans: [{ fanKey: "7", fanName: "Duchamp", fanHandle: "duchampprivate", avatarUrl: null }],
      reason: null,
      status: 200,
    },
  ]);
  assert.deepEqual(merged.fans.map((fan) => fan.fanHandle), ["duchampprivate"]);
  assert.deepEqual(merged.notices, [`9ikis52: ${SESSION_EXPIRED_LABEL}`]);
});

test("un 200 filtrado sin isOnline cuenta las filas", () => {
  const read = onlineReadFromPayload(200, {
    data: { list: [{ id: 21, username: "duchampprivate" }, { id: 22, username: "brendababypremium" }] },
  });
  assert.equal(read.reason, null);
  assert.equal(read.fans.length, 2);
});

test("si las reglas de firma cuelgan, el error sale en 5 s y no pide Chromium", { timeout: 15_000 }, async () => {
  clearSignRulesCache();
  const started = Date.now();
  let subscribers = 0;
  const read = await fetchSignedOnlineFans(sessionState(), {
    now: () => started,
    fetch: (input, init) => new Promise((_resolve, reject) => {
      const url = String(input);
      if (url.includes("/subscriptions/subscribers")) subscribers += 1;
      const abort = () => reject(new DOMException("The operation was aborted", "AbortError"));
      if (init?.signal?.aborted) abort();
      else init?.signal?.addEventListener("abort", abort, { once: true });
    }),
  });
  const elapsed = Date.now() - started;
  assert.equal(read.reason, "No se pudo leer.");
  assert.equal(read.fallback, false);
  assert.equal(subscribers, 0);
  assert.equal(RULES_TIMEOUT_MS, 5_000);
  assert.ok(elapsed >= 4_500 && elapsed < 8_000, `tardó ${elapsed} ms`);
  clearSignRulesCache();
});

test("un json colgado no se salta el tope ni abre el respaldo", { timeout: 20_000 }, async () => {
  const started = Date.now();
  const rules = parseSignRules({
    static_param: "param",
    format: "1:{}:{:x}:2",
    checksum_indexes: [0, 1],
    checksum_constant: 10,
    app_token: "token",
  });
  assert.ok(rules);
  const read = await fetchSignedOnlineFans(sessionState(), {
    now: () => started,
    rules,
    fetch: async () => ({
      ok: true,
      status: 200,
      json: () => new Promise<unknown>(() => undefined),
    }) as Response,
  });
  const elapsed = Date.now() - started;
  assert.equal(read.reason, "No se pudo leer.");
  assert.equal(read.fallback, false);
  assert.equal(read.fans.length, 0);
  assert.ok(elapsed >= 4_500 && elapsed < 8_000, `tardó ${elapsed} ms`);
});

test("readOnlineFans con reglas colgadas devuelve fallback false y no abre Chromium", { timeout: 20_000 }, async () => {
  clearSignRulesCache();
  const dataDir = await tempDataDir();
  const events: string[] = [];
  const created = await createSessionRuntime({
    config: testConfig(dataDir),
    site: onlyFansSite,
    displayEnv: testDisplay,
    browserFactory: {
      async launchPersistentContext() {
        events.push("persistent");
        throw new Error("no se abre Chromium");
      },
      async launch() {
        events.push("launch");
        throw new Error("no se abre Chromium");
      },
    },
  });
  try {
    const account = await created.sessions.ensureAccount("Prueba", "3zk7kbr");
    await writeEncryptedSession(path.join(dataDir, "sessions", `${account.id}.json`), sessionState(), TEST_SESSION_KEY);
    const started = Date.now();
    const read = await created.sessions.readOnlineFans(account.id, {
      fetch: (_input, init) => new Promise((_resolve, reject) => {
        const abort = () => reject(new DOMException("The operation was aborted", "AbortError"));
        if (init?.signal?.aborted) abort();
        else init?.signal?.addEventListener("abort", abort, { once: true });
      }),
    });
    const elapsed = Date.now() - started;
    assert.equal(read.reason, "No se pudo leer.");
    assert.equal(read.fallback, false);
    assert.deepEqual(events, []);
    assert.ok(elapsed >= 4_500 && elapsed < 8_000, `tardó ${elapsed} ms`);
  } finally {
    clearSignRulesCache();
    await removeDir(dataDir);
  }
});

test("el respaldo abre Colecciones en Todo y no la lista Fans", async () => {
  assert.deepEqual([...ONLINE_COLLECTION_URLS], ["https://onlyfans.com/my/collections/subscribers/active"]);
  assert.equal(ONLINE_COLLECTION_URLS.some((url) => url.includes("user-lists")), false);
  const seen: string[] = [];
  const read = await readOnlineSubscribers(collectionPage(seen), undefined, [
    "https://onlyfans.com/my/collections/user-lists/subscribers/fans",
    "https://onlyfans.com/my/collections/subscribers/active",
  ]);
  assert.deepEqual(seen.filter((item) => item.startsWith("goto:")), [
    "goto:https://onlyfans.com/my/collections/subscribers/active",
  ]);
  assert.ok(seen.some((item) => item.startsWith("tab:")));
  assert.ok(seen.some((item) => item.includes("filtros")));
  assert.ok(seen.some((item) => item.includes("en línea")));
  assert.equal(read.reason, null);
  assert.deepEqual(read.fans.map((fan) => fan.fanHandle), ["duchampprivate"]);
});

test("si el goto o el filtro de la página fallan, no se dice que no hay nadie", async () => {
  const missed = await readOnlineSubscribers(failingPage(), undefined, ["http://127.0.0.1/fans"]);
  assert.equal(missed.reason, "No se pudo leer.");
  assert.deepEqual(missed.fans, []);
});

function sessionState(): StorageStateFile {
  return {
    cookies: [cookie("auth_id", "42"), cookie("sess", "ok-1")],
    origins: [{ origin: "https://onlyfans.com", localStorage: [{ name: "bcTokenSha", value: "huella" }] }],
  };
}

function cookie(name: string, value: string): StorageStateFile["cookies"][number] {
  return { name, value, domain: ".onlyfans.com", path: "/", expires: -1, httpOnly: true, secure: true, sameSite: "Lax" };
}

function collectionPage(seen: string[]): Page {
  const handlers: Array<(response: { url(): string; status(): number; text(): Promise<string> }) => void> = [];
  const clickable = (label: string) => ({
    async click() {
      seen.push(label);
      if (!label.includes("aplicar") && !label.includes("apply")) return;
      for (const handler of handlers) {
        handler({
          url: () => `https://onlyfans.com${ONLINE_SUBSCRIBERS_PATH}`,
          status: () => 200,
          text: async () => JSON.stringify({
            data: {
              list: [
                { id: 7, username: "duchampprivate" },
                { id: 8, username: "offline", isOnline: false },
              ],
            },
          }),
        });
      }
    },
    first() { return this; },
  });
  return {
    on(event: string, handler: (response: { url(): string; status(): number; text(): Promise<string> }) => void) {
      if (event === "response") handlers.push(handler);
    },
    off() {},
    isClosed() { return false; },
    async goto(url: string) { seen.push(`goto:${url}`); },
    locator() { return clickable("locator:filter"); },
    getByText(name: RegExp) { return clickable(`text:${name}`); },
    getByRole(role: string, options?: { name?: RegExp }) { return clickable(`${role}:${options?.name}`); },
    waitForResponse() { return Promise.resolve(); },
  } as unknown as Page;
}

function failingPage(): Page {
  const refuse = async () => {
    throw new Error("no");
  };
  return {
    on() {},
    off() {},
    isClosed() { return false; },
    goto: refuse,
    locator() { return { first: () => ({ click: refuse }) }; },
    getByText() { return { first: () => ({ click: refuse }) }; },
    getByRole() { return { click: refuse }; },
    waitForResponse: refuse,
  } as unknown as Page;
}
