import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { notificationActionText, notificationOpensChat, noticeTab, noticesForOfTab, ofListType, ofTabListNote, parseNotificationPayload, tabOf } from "../../../src/lib/notifications.ts";
import type { StorageStateFile } from "../sessions/storage-state.ts";
import { clearAccountChatPace } from "../sync/api-list-pace.ts";
import { clearAccountPauses, noteAccountBlock } from "../sync/backoff.ts";
import { passNotificationAccounts } from "../sync/notification-cycle.ts";
import {
  clearNotificationListPlans,
  dispatchNotificationMark,
  fetchNotificationList,
  fetchSignedNotifications,
  nextNoticeListType,
  noticeListQueue,
  TAG_MENTIONS_PATH,
  withMe,
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
  // El 400 del contador no borra lo que /users/me sí trajo (Etiquetas); el resto queda sin dato.
  assert.equal(read.counts?.tags, 1);
  assert.equal(read.counts?.all, null);
  assert.equal(read.counts?.purchases, null);
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

test("cada pestaña con no leídas pide su type y no se mezcla", async () => {
  clearNotificationListPlans();
  const counts = { all: 2, purchases: 1, tip: 1, subscribed: 0, commented: 0, mentioned: 0, favorited: 0, message: 0, deactivated_media: 0 };
  const respond = (url: string) => {
    const type = new URL(url).searchParams.get("type");
    if (url.endsWith(notificationCountPath())) return json(200, counts);
    if (url.endsWith("/users/me")) return json(200, { newTagsCount: 2 });
    if (type === "purchases") return json(200, { list: [{ id: "c1", type: "paided_message", text: "pagó", createdAt: "2026-11-13T10:00:00.000Z", user: { id: 1, name: "Arias", username: "arias_crazy1" } }], hasMore: false });
    if (type === "tip") return json(200, { list: [{ id: "t1", type: "tip", text: "propina", createdAt: "2026-11-13T11:00:00.000Z", user: { id: 2, name: "Mishell", username: "mishellxy" } }], hasMore: false });
    return json(200, { list: [{ id: "mix", type: "paided_message", text: "pagó", createdAt: "2026-11-13T09:00:00.000Z", user: { id: 1, name: "Arias", username: "arias_crazy1" } }], hasMore: false });
  };
  const read = async () => {
    const urls: string[] = [];
    const methods: string[] = [];
    const result = await fetchSignedNotifications(state(), { ...deps(urls, respond, methods), accountId: "tabs" });
    return { urls, methods, result };
  };
  const first = await read();
  const second = await read();
  const third = await read();
  assert.equal([...first.methods, ...second.methods, ...third.methods].every((method) => method === "GET"), true);
  assert.equal(new URL(first.urls[0] ?? "").searchParams.get("type"), null);
  assert.equal(new URL(second.urls[0] ?? "").searchParams.get("type"), "subscribed");
  assert.equal(new URL(third.urls[0] ?? "").searchParams.get("type"), "purchases");
  assert.equal(second.result.items.every((item) => item.ofType === "subscribed"), true);
  assert.equal(third.result.items.every((item) => item.ofType === "purchases"), true);
  assert.equal(third.result.items[0]?.fanHandle, "arias_crazy1");
  assert.equal(second.result.counts?.tags, 2);
  assert.equal(ofTabListNote({ tab: "tags", unread: 2, listed: 0 })?.includes("2 no leídas"), true);
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
  clearNotificationListPlans();
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

test("una sesión rechazada se omite y el log lo dice", async () => {
  const lines: string[] = [];
  let reads = 0;
  await passNotificationAccounts({
    accounts: [{
      id: "acc",
      creatorId: "9ikis52",
      status: "active",
      identityState: "verified",
      hasStorageState: true,
      sessionRejected: true,
      connection: "login_required",
    }],
    noted: new Set(),
    pace: new Map(),
    now: () => 1,
    read: async () => {
      reads += 1;
      return fetchSignedNotifications(state(), deps([], () => json(200, { list: [], hasMore: false, all: 0, newTagsCount: 0 })));
    },
    finish: async () => undefined,
    onBlock: () => undefined,
    log: (line) => lines.push(line),
  });
  assert.equal(reads, 0);
  assert.equal(lines[0], "[fanlink:notif] creator=9ikis52 ruta=lista n=0 motivo=se omite (sesión rechazada) status=");
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

test("con el flag apagado no se lee la sesión ni se llama a OnlyFans", async () => {
  const dir = await tempDataDir();
  const previousFlag = process.env.FANLINK_NOTIF_MARK_READ;
  const previousAllow = process.env.FANLINK_SEND_ALLOW_ACCOUNTS;
  delete process.env.FANLINK_NOTIF_MARK_READ;
  delete process.env.FANLINK_SEND_ALLOW_ACCOUNTS;
  let fetched = 0;
  const account: Account = {
    id: "11111111-1111-4111-8111-111111111111",
    creatorId: "3zk7kbr",
    label: "Prueba",
    status: "active",
    loginInProgress: false,
    sessionRejected: false,
    hasStorageState: false,
    connection: "live",
    identityState: "verified",
    identityLabel: null,
    identityHandle: "3zk7kbr",
    identityName: null,
    identityUserId: "42",
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
    const marked = await sessions.markNotificationsOnOnlyfans(account.id, { all: true, types: [] });
    assert.equal(fetched, 0);
    assert.equal(marked.wrote, false);
    assert.equal(marked.motivo, "marcado apagado");
    account.identityState = "mismatch";
    process.env.FANLINK_NOTIF_MARK_READ = "true";
    process.env.FANLINK_SEND_ALLOW_ACCOUNTS = "3zk7kbr";
    const blocked = await sessions.markNotificationsOnOnlyfans(account.id, { all: true, types: [] });
    assert.equal(fetched, 0);
    assert.equal(blocked.motivo, "no se pudo leer");
  } finally {
    if (previousFlag == null) delete process.env.FANLINK_NOTIF_MARK_READ;
    else process.env.FANLINK_NOTIF_MARK_READ = previousFlag;
    if (previousAllow == null) delete process.env.FANLINK_SEND_ALLOW_ACCOUNTS;
    else process.env.FANLINK_SEND_ALLOW_ACCOUNTS = previousAllow;
    await removeDir(dir);
  }
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
      const path = new URL(url).pathname;
      assert.equal(headers?.["user-id"], "42");
      if (path === "/api2/v2/users/notifications/read" || path.startsWith("/api2/v2/users/notifications/read/")) {
        assert.equal(headers?.["user-id"], "42");
      }
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


// Fixture con la forma de GET /release-forms/mentions del catálogo ({list, hasMore, lastId}).
// Los campos de cada fila (id, user, createdAt) son los que el catálogo no detalla: no están confirmados con datos reales.
const tagMentions = {
  list: [
    { id: 9001, createdAt: "2026-11-27T20:15:00.000Z", isRead: false, user: { id: 555, name: "Jason Carrera", username: "jasonc", avatar: "https://cdn.example/a.jpg" } },
    { id: 9002, createdAt: "2026-11-26T09:00:00.000Z", user: { id: 556, name: "Marta", username: "marta" } },
    { releaseForm: { id: 9003 }, date: "2026-11-25T09:00:00.000Z", user: { id: 42, name: "Cuenta propia", username: "yo" } },
    { note: "sin id ni fecha" },
  ],
  hasMore: false,
  lastId: 9003,
};

test("Etiquetas se pide a release-forms/mentions, con GET y no como type de notificaciones", async () => {
  assert.equal(notificationListPath("tags"), TAG_MENTIONS_PATH);
  assert.match(TAG_MENTIONS_PATH, /^\/api2\/v2\/release-forms\/mentions\?limit=\d+&offset=0&format=infinite$/);
  assert.doesNotMatch(notificationListPath("tags"), /users\/notifications/);
  assert.match(notificationListPath("message"), /users\/notifications\?limit=\d+&format=infinite&type=message$/);
  assert.equal(ofListType("tags"), "tags");
  assert.equal(ofListType("promotions"), "message");
  const urls: string[] = [];
  const methods: string[] = [];
  const page = await fetchNotificationList(state(), deps(urls, () => json(200, tagMentions), methods), "tags");
  assert.deepEqual(methods, ["GET"]);
  assert.equal(new URL(urls[0]!).pathname, "/api2/v2/release-forms/mentions");
  assert.equal(page.status, 200);
  const rows = page.items;
  assert.deepEqual(rows.map((row) => row.key), ["tag:9001", "tag:9002", "tag:9003"]);
  assert.ok(rows.every((row) => row.kind === "tag" && row.ofType === "tags" && !row.pending));
  assert.equal(rows[0]?.fanKey, "555");
  assert.equal(rows[0]?.fanName, "Jason Carrera");
  assert.equal(rows[0]?.fanHandle, "jasonc");
  assert.equal(rows[0]?.ofUnread, true);
  assert.equal(rows[1]?.ofUnread, null);
  assert.equal(rows[2]?.fanKey, null);
  assert.equal(noticeTab(rows[0]!), "tags");
  assert.equal(noticesForOfTab(rows, "tags").length, 3);
  assert.equal(noticesForOfTab(rows, "promotions").length, 0);
  assert.deepEqual(parseNotificationPayload({ list: [] }, { listType: "tags" }), []);
  assert.deepEqual(parseNotificationPayload("basura", { listType: "tags" }), []);
});

test("la cola de listas incluye Etiquetas y Promociones, y cada pasada pide una sola lista", async () => {
  const queue = noticeListQueue();
  assert.ok(queue.includes("tags"));
  assert.ok(queue.includes("message"));
  assert.equal(queue.length, 10);
  const seen = new Set<string | null>();
  let cursor = 0;
  for (let index = 0; index < queue.length; index += 1) {
    const step = nextNoticeListType(cursor);
    seen.add(step.type);
    cursor = step.next;
  }
  assert.equal(seen.size, queue.length);
  clearNotificationListPlans();
  const calls: string[] = [];
  const respond = (url: string) => {
    calls.push(new URL(url).pathname);
    if (url.endsWith(notificationCountPath())) return json(200, { all: 1, message: 1 });
    if (url.endsWith("/users/me")) return json(200, { notificationsCount: 10, chatMessagesCount: 6, newTagsCount: 9 });
    return json(200, { list: [], hasMore: false });
  };
  for (let index = 0; index < queue.length; index += 1) {
    calls.length = 0;
    await fetchSignedNotifications(state(), { ...deps([], respond), accountId: "acc-tags" });
    assert.equal(calls.length, 3, "lista, contador y users/me: tres GET por pasada");
  }
  clearNotificationListPlans();
});

test("los contadores salen de OnlyFans: Notificaciones 10, Etiquetas 9, Promociones 1, Mensajes 6", async () => {
  clearNotificationListPlans();
  // Caso de Jose (3zk7kbr): /notifications/count trae all=1 (sin Etiquetas) y message=1.
  // La barra lateral de OnlyFans enseña notificationsCount=10 y chatMessagesCount=6.
  const read = await fetchSignedNotifications(state(), deps([], (url) => {
    if (url.endsWith(notificationCountPath())) return json(200, { all: 1, subscribed: 0, purchases: 0, tip: 0, commented: 0, mentioned: 0, favorited: 0, message: 1, deactivated_media: 0 });
    if (url.endsWith("/users/me")) return json(200, { notificationsCount: 10, chatMessagesCount: 6, newTagsCount: 9 });
    return json(200, { list: [], hasMore: false });
  }));
  assert.equal(read.counts?.all, 10);
  assert.equal(read.counts?.tags, 9);
  assert.equal(read.counts?.promotions, 1);
  assert.equal(read.chatUnread, 6);
  assert.equal(read.motivo, "ok");
});

test("sin notificationsCount en users/me, el total se queda con el del contador y no se inventa", () => {
  const base = { all: 1, subscriptions: 0, purchases: 0, tips: 0, tags: null, comments: 0, mentions: 0, likes: 0, promotions: 1, onlyfans: 0 };
  assert.equal(withMe(base, { notifications: null, chats: null, tags: null })?.all, 1);
  assert.equal(withMe(base, { notifications: null, chats: null, tags: 9 })?.tags, 9);
  assert.equal(withMe(null, { notifications: null, chats: 3, tags: null }), null);
  assert.equal(withMe(null, { notifications: 10, chats: null, tags: null })?.all, 10);
});

test("marcar leído relee users/me y no pierde Etiquetas ni el total de la barra lateral", async () => {
  const result = await dispatchNotificationMark({
    flag: "true",
    allowlist: "3zk7kbr",
    account: { creatorId: "3zk7kbr", accountId: "acc", handle: null, userId: null, label: null },
    state: state(),
    deps: deps([], (url) => {
      if (url.endsWith(notificationCountPath())) return json(200, { all: 0, message: 0 });
      if (url.endsWith("/users/me")) return json(200, { notificationsCount: 9, chatMessagesCount: 6, newTagsCount: 9 });
      return json(200, { success: true });
    }),
    scope: { all: true, types: [] },
  });
  assert.equal(result.wrote, true);
  assert.equal(result.counts?.all, 9);
  assert.equal(result.counts?.tags, 9);
  assert.equal(result.chatUnread, 6);
});


test("solo me gusta, PPV, propinas y suscripciones llevan al chat; el resto solo se ve", () => {
  for (const kind of ["like", "ppv", "tip", "subscription", "renewal"] as const) assert.equal(notificationOpensChat(kind), true, kind);
  for (const kind of ["tag", "promotion", "comment", "mention", "system", "message", "agency", "other"] as const) assert.equal(notificationOpensChat(kind), false, kind);
  assert.equal(notificationActionText("tip"), "Ha enviado una propina");
  assert.equal(notificationActionText("other"), null);
});
