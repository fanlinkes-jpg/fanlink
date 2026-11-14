import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { tabOf } from "../../../src/lib/notifications.ts";
import type { StorageStateFile } from "../sessions/storage-state.ts";
import { clearAccountChatPace } from "../sync/api-list-pace.ts";
import { clearAccountPauses, noteAccountBlock } from "../sync/backoff.ts";
import { passNotificationAccounts } from "../sync/notification-cycle.ts";
import {
  dispatchNotificationMark,
  fetchSignedNotifications,
  notificationCountPath,
  notificationListPath,
  notificationLogLine,
  NOTIFICATION_MARK_ALL_PATH,
  type SignedNotificationDeps,
} from "../sync/of-notifications-api.ts";
import type { SignRules } from "../sync/of-sign.ts";
import { SessionManager } from "../sessions/session-manager.ts";
import { onlyFansSite } from "../sessions/onlyfans.ts";
import type { BrowserFactory } from "../sessions/browser-factory.ts";
import type { Account } from "../types.ts";
import { removeDir, tempDataDir, testConfig, testDisplay } from "./helpers.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const rules: SignRules = {
  staticParam: "param",
  format: "1:{}:{:x}:2",
  checksumIndexes: [0, 1],
  checksumConstants: [50, 50],
  checksumConstant: 100,
  appToken: "token",
  removeHeaders: ["user-id"],
};

const counts = {
  all: 4,
  subscribed: 1,
  purchases: 1,
  tip: 1,
  tags: 0,
  commented: 0,
  mentioned: 0,
  favorited: 1,
  message: 0,
  deactivated_media: 1,
};

test("el parser lee el fixture citado y separa a la creadora", async () => {
  const body = JSON.parse(await readFile(path.join(root, "server/of-sessions/test/fixtures/of-notifications-list.json"), "utf8"));
  const urls: string[] = [];
  const read = await fetchSignedNotifications(state(), deps(urls, (url) => {
    if (url.endsWith(notificationCountPath())) return json(200, counts);
    if (url.endsWith("/users/me")) return json(200, { newTagsCount: 3 });
    return json(200, body);
  }));
  assert.equal(read.motivo, "ok");
  assert.equal(read.status, 200);
  assert.equal(read.captured, true);
  assert.equal(read.counts?.purchases, 1);
  assert.equal(read.counts?.tips, 1);
  assert.equal(read.counts?.likes, 1);
  assert.equal(read.counts?.onlyfans, 1);
  assert.equal(read.counts?.subscriptions, 1);
  const purchase = read.items.find((item) => item.key === "117301756206");
  assert.equal(purchase?.kind, "ppv");
  assert.equal(purchase?.amountCents, 600);
  assert.equal(purchase?.fanKey, "482191");
  assert.equal(purchase?.fanName, "Daniel");
  assert.equal(purchase?.threadKey, "482191");
  assert.equal(purchase?.ofUnread, true);
  assert.equal(tabOf(purchase!.kind), "purchases");
  const own = read.items.find((item) => item.key === "201");
  assert.equal(own?.fanKey, null);
  assert.equal(tabOf(own!.kind), "promotions");
  const self = read.items.find((item) => item.key === "204");
  assert.equal(self?.fanKey, null);
  assert.equal(tabOf(self!.kind), "onlyfans");
  const fan = read.items.find((item) => item.key === "200");
  assert.equal(fan?.fanKey, "7");
  assert.equal(tabOf(fan!.kind), "subscriptions");
  assert.equal(new URL(urls[0] ?? "").pathname, "/api2/v2/users/notifications");
  assert.equal(read.counts?.tags, 3);
  assert.equal(read.signatureRejected, false);
});

test("un 401 es sesión caída y no sigue pidiendo", async () => {
  const urls: string[] = [];
  const read = await fetchSignedNotifications(state(), deps(urls, () => json(401, { error: "no" })));
  assert.equal(read.sessionRejected, true);
  assert.equal(read.signatureRejected, false);
  assert.equal(read.motivo, "sesión caída");
  assert.equal(read.status, 401);
  assert.equal(read.captured, false);
  assert.equal(read.counts, null);
  assert.equal(urls.length, 1);
  assert.equal(new URL(urls[0] ?? "").pathname, "/api2/v2/users/notifications");
  assert.equal(notificationLogLine({ creatorId: "3zk7kbr", route: "lista", count: 0, motivo: read.motivo, status: read.status }), "[fanlink:notif] creator=3zk7kbr ruta=lista n=0 motivo=sesión caída status=401");
});

test("un 400 es firma rechazada y no se disfraza de cero", async () => {
  const urls: string[] = [];
  const read = await fetchSignedNotifications(state(), deps(urls, () => json(400, { error: "sign" })));
  assert.equal(read.signatureRejected, true);
  assert.equal(read.sessionRejected, false);
  assert.equal(read.motivo, "firma rechazada");
  assert.equal(read.status, 400);
  assert.equal(read.items.length, 0);
  assert.equal(urls.length, 1);
  assert.match(notificationLogLine({ creatorId: "3zk7kbr", route: "lista", count: 0, motivo: read.motivo, status: read.status }), /motivo=firma rechazada status=400/);
});

test("un 400 del contador deja ver la lista y no marca la firma", async () => {
  const urls: string[] = [];
  const read = await fetchSignedNotifications(state(), deps(urls, (url) => {
    if (url.endsWith(notificationCountPath())) return json(400, { error: "sign" });
    if (url.endsWith("/users/me")) return json(200, { newTagsCount: 1 });
    return json(200, { list: [{ id: "n1", type: "tip", text: "propina", createdAt: "2026-11-12T10:00:00.000Z", user: { id: 7, name: "Ana" } }], hasMore: false });
  }));
  assert.equal(read.captured, true);
  assert.equal(read.signatureRejected, false);
  assert.equal(read.sessionRejected, false);
  assert.equal(read.items.length, 1);
  assert.equal(read.counts, null);
  assert.equal(read.countMotivo, "firma rechazada");
  assert.equal(read.routes.find((route) => route.route === "contador")?.status, 400);
});

test("una lista vacía dice sin notificaciones", async () => {
  const urls: string[] = [];
  const read = await fetchSignedNotifications(state(), deps(urls, (url) => {
    if (url.endsWith(notificationCountPath())) return json(200, { ...counts, all: 0, subscribed: 0, purchases: 0, tip: 0, favorited: 0, deactivated_media: 0 });
    return json(200, { list: [], hasMore: false });
  }));
  assert.equal(read.captured, true);
  assert.equal(read.motivo, "sin notificaciones");
  assert.equal(read.items.length, 0);
  assert.equal(read.counts?.all, 0);
  assert.equal(read.status, 200);
  assert.deepEqual(urls.map((url) => new URL(url).pathname), [
    "/api2/v2/users/notifications",
    "/api2/v2/users/notifications/count",
    "/api2/v2/users/me",
  ]);
  const list = new URL(urls[0] ?? "");
  assert.equal(list.searchParams.get("limit"), "10");
  assert.equal(list.searchParams.get("format"), "infinite");
  assert.equal(list.searchParams.get("type"), null);
  assert.equal(notificationListPath().includes("format=infinite"), true);
});

test("un 429 en la lista no pide el contador ni a /users/me", async () => {
  const urls: string[] = [];
  const read = await fetchSignedNotifications(state(), deps(urls, () => json(429, { error: "slow" }, { retryAfter: "3" })));
  assert.equal(urls.length, 1);
  assert.equal(read.retryAfterMs, 3_000);
  assert.equal(read.captured, false);
  assert.equal(read.signatureRejected, false);
});

test("el bucle real pide como mucho 6 veces por minuto y solo cuentas activas", async () => {
  clearAccountChatPace();
  clearAccountPauses();
  let now = 1_000_000;
  const calls: Array<{ at: number; account: string }> = [];
  const pace = new Map();
  const noted = new Set<string>();
  const active = { id: "acc", creatorId: "3zk7kbr", status: "active" as const, identityState: "verified", hasStorageState: true };
  const quiet = { id: "off", creatorId: "otra", status: "expired" as const, identityState: "verified", hasStorageState: true };
  const read = async (account: { id: string }) => fetchSignedNotifications(state(), {
    rules,
    accountId: account.id,
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
    fetch: (async () => {
      calls.push({ at: now, account: account.id });
      return json(200, { list: [{ id: "1", type: "tip", text: "t", createdAt: "2026-11-01T00:00:00.000Z", isRead: false, user: { id: 3, name: "A" } }], hasMore: false, all: 1, subscribed: 0, purchases: 0, tip: 1, newTagsCount: 0 });
    }) as typeof fetch,
  });
  const blocks: string[] = [];
  await passNotificationAccounts({
    accounts: [quiet, active],
    noted,
    pace,
    now: () => now,
    read,
    finish: async () => undefined,
    onBlock: (id) => blocks.push(id),
  });
  now += 45_000;
  await passNotificationAccounts({
    accounts: [quiet, active],
    noted,
    pace,
    now: () => now,
    read,
    finish: async () => undefined,
    onBlock: (id) => blocks.push(id),
  });
  now += 15_000;
  await passNotificationAccounts({
    accounts: [active],
    noted,
    pace,
    now: () => now,
    read,
    finish: async () => undefined,
    onBlock: (id) => blocks.push(id),
  });
  assert.equal(calls.every((call) => call.account === "acc"), true);
  const window = calls.filter((call) => call.at < 1_000_000 + 60_000);
  assert.equal(window.length <= 6, true);
  assert.equal(window.length, 6);
  assert.equal(blocks.length, 0);
});

test("el aviso de una cuenta omitida vuelve cuando regresa y se cae otra vez", async () => {
  const noted = new Set<string>();
  const lines: string[] = [];
  const base = { id: "acc", creatorId: "3zk7kbr", identityState: "verified", hasStorageState: true };
  const run = (status: "expired" | "active") => passNotificationAccounts({
    accounts: [{ ...base, status }],
    noted,
    pace: new Map(),
    now: () => 1,
    read: async () => fetchSignedNotifications(state(), deps([], () => json(200, { list: [], hasMore: false, all: 0, newTagsCount: 0 }))),
    finish: async () => undefined,
    onBlock: () => undefined,
    log: (line) => lines.push(line),
  });
  await run("expired");
  await run("expired");
  await run("active");
  await run("expired");
  assert.equal(lines.filter((line) => line.includes("se omite")).length, 2);
});

test("el bucle no pausa por un 400 del contador, sí por 429 y 401 se queda en la lista", async () => {
  clearAccountPauses();
  clearAccountChatPace();
  const pace = new Map();
  const noted = new Set<string>();
  const account = { id: "acc", creatorId: "3zk7kbr", status: "active" as const, identityState: "verified", hasStorageState: true };
  const blocks: string[] = [];
  await passNotificationAccounts({
    accounts: [account],
    noted,
    pace,
    now: () => 5_000,
    read: async () => fetchSignedNotifications(state(), deps([], (url) => url.endsWith(notificationCountPath()) ? json(400, {}) : json(200, { list: [{ id: "9", type: "like", text: "gusta", createdAt: "2026-11-02T00:00:00.000Z", user: { id: 4, name: "Paz" } }], hasMore: false, newTagsCount: 0 }))),
    finish: async (_account, read) => {
      assert.equal(read.items.length, 1);
      assert.equal(read.signatureRejected, false);
    },
    onBlock: (id, reason) => blocks.push(`${id}:${reason}`),
  });
  assert.deepEqual(blocks, []);
  clearAccountChatPace();
  const pace429 = new Map();
  const urls: string[] = [];
  await passNotificationAccounts({
    accounts: [account],
    noted: new Set(),
    pace: pace429,
    now: () => 9_000,
    read: async () => fetchSignedNotifications(state(), deps(urls, () => json(429, {}, { retryAfter: "2" }))),
    finish: async () => undefined,
    onBlock: (id, reason) => noteAccountBlock(id, reason, 9_000, () => 0),
  });
  assert.equal(urls.length, 1);
  const later: string[] = [];
  await passNotificationAccounts({
    accounts: [account],
    noted: new Set(),
    pace: pace429,
    now: () => 9_000 + 1_000,
    read: async () => fetchSignedNotifications(state(), deps(later, () => json(200, { list: [], hasMore: false, all: 0 }))),
    finish: async () => undefined,
    onBlock: () => undefined,
  });
  assert.equal(later.length, 0);
});

test("marcar leídas firma el POST y relee el contador; apagado no llama", async () => {
  const urls: string[] = [];
  const methods: string[] = [];
  const off = await dispatchNotificationMark({
    flag: undefined,
    allowlist: "3zk7kbr",
    account: { creatorId: "3zk7kbr", accountId: "acc", handle: null, userId: null, label: null },
    state: state(),
    deps: deps(urls, () => json(200, {}), methods),
    scope: { all: true, types: [] },
  });
  assert.equal(off.wrote, false);
  assert.equal(off.motivo, "marcado apagado");
  assert.equal(urls.length, 0);
  assert.equal(methods.some((method) => method === "POST" || method === "PUT"), false);
  const outside = await dispatchNotificationMark({
    flag: "true",
    allowlist: "otra",
    account: { creatorId: "3zk7kbr", accountId: "acc", handle: null, userId: null, label: null },
    state: state(),
    deps: deps(urls, () => json(200, {}), methods),
    scope: { all: true, types: [] },
  });
  assert.equal(outside.wrote, false);
  assert.equal(urls.length, 0);
  const on = await dispatchNotificationMark({
    flag: "true",
    allowlist: "3zk7kbr",
    account: { creatorId: "3zk7kbr", accountId: "acc", handle: null, userId: null, label: null },
    state: state(),
    deps: deps(urls, (url) => url.endsWith(notificationCountPath()) ? json(200, { all: 0, tip: 0 }) : json(200, { counters: { all: 0 } }), methods),
    scope: { all: true, types: [] },
  });
  assert.equal(on.wrote, true);
  assert.equal(on.counts?.all, 0);
  assert.equal(methods.filter((method) => method === "POST").length, 1);
  assert.equal(methods.includes("PUT"), false);
  assert.equal(new URL(urls[0] ?? "").pathname, NOTIFICATION_MARK_ALL_PATH);
  const failed = await dispatchNotificationMark({
    flag: "true",
    allowlist: "3zk7kbr",
    account: { creatorId: "3zk7kbr", accountId: "acc", handle: null, userId: null, label: null },
    state: state(),
    deps: deps([], () => json(400, { error: "sign" })),
    scope: { all: false, types: ["tip"] },
  });
  assert.equal(failed.wrote, false);
  assert.equal(failed.motivo, "firma rechazada");
  assert.equal(failed.counts, null);
  const denied = await dispatchNotificationMark({
    flag: "true",
    allowlist: "3zk7kbr",
    account: { creatorId: "3zk7kbr", accountId: "acc", handle: null, userId: null, label: null },
    state: state(),
    deps: deps([], () => json(401, { error: "no" })),
    scope: { all: false, types: ["tip"] },
  });
  assert.equal(denied.motivo, "sesión caída");
  assert.equal(denied.counts, null);
});

test("una identidad que no coincide no pide la lista", async () => {
  const dir = await tempDataDir();
  let fetched = 0;
  const account: Account = {
    id: "acc",
    creatorId: "3zk7kbr",
    label: "Prueba",
    status: "active",
    loginInProgress: false,
    sessionRejected: false,
    hasStorageState: true,
    connection: "live",
    identityState: "mismatch",
    identityLabel: null,
    identityHandle: "otra",
    identityName: null,
    identityUserId: "9",
    identityCheckedAt: null,
    identityReason: null,
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z",
    lastCheckedAt: null,
    lastError: null,
  };
  const sessions = new SessionManager({
    config: testConfig(dir),
    store: {
      init: async () => undefined,
      list: async () => [account],
      get: async () => account,
      findByCreator: async () => account,
      create: async () => account,
      update: async () => account,
    },
    site: onlyFansSite,
    browsers: { launch: async () => { throw new Error("no"); } } as unknown as BrowserFactory,
    displayEnv: testDisplay,
    fetch: (async () => {
      fetched += 1;
      throw new Error("no");
    }) as typeof fetch,
  });
  try {
    const read = await sessions.readNotificationsDirect(account.id);
    assert.equal(fetched, 0);
    assert.equal(read.captured, false);
    assert.match(read.reason ?? "", /otra cuenta/);
  } finally {
    await removeDir(dir);
  }
});

function deps(urls: string[], respond: (url: string) => Response, methods?: string[]): SignedNotificationDeps {
  return {
    rules,
    now: () => 1_700_000_000_000,
    sleep: async () => undefined,
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      urls.push(url);
      methods?.push((init?.method ?? "GET").toUpperCase());
      const headers = init?.headers as Record<string, string> | undefined;
      assert.equal(typeof headers?.sign, "string");
      assert.equal(headers?.cookie?.includes("\n"), false);
      return respond(url);
    }) as typeof fetch,
  };
}

function json(status: number, body: unknown, extra?: { retryAfter?: string }): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name: string) => (name.toLowerCase() === "retry-after" ? extra?.retryAfter ?? null : null) },
    json: async () => body,
  } as unknown as Response;
}

function state(): StorageStateFile {
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
