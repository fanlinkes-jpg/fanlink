import assert from "node:assert/strict";
import { test } from "node:test";
import type { BrowserFactory } from "../sessions/browser-factory.ts";
import type { StorageStateFile } from "../sessions/storage-state.ts";
import { fetchSignedChats, parseSetCookieLine, type SignedChatDeps } from "../sync/of-chat-api.ts";
import type { SignRules } from "../sync/of-sign.ts";

const rules: SignRules = {
  staticParam: "param",
  format: "1:{}:{:x}:2",
  checksumIndexes: [0, 1],
  checksumConstants: [50, 50],
  checksumConstant: 10,
  appToken: "token",
  removeHeaders: ["user-id"],
};

test("pagina la lista hasta el tope", async () => {
  const urls: string[] = [];
  const read = await fetchSignedChats(state(), deps(urls, (url) => {
    const offset = Number(new URL(url).searchParams.get("offset"));
    const start = offset + 1;
    return json(200, {
      list: Array.from({ length: 20 }, (_, index) => thread(String(start + index))),
      hasMore: true,
    });
  }), { listCap: 60 });
  const lists = urls.filter((url) => url.includes("/api2/v2/chats?"));
  assert.deepEqual(lists.map((url) => new URL(url).searchParams.get("offset")), ["0", "20", "40"]);
  assert.equal(lists.some((url) => new URL(url).searchParams.get("offset") === "60"), false);
  assert.equal(read.threads.length, 60);
  assert.equal(read.reason, null);
  assert.equal(read.sessionRejected, false);
});

test("pide los mensajes del hilo abierto aunque esté en la posición 30", async () => {
  const urls: string[] = [];
  await fetchSignedChats(state(), deps(urls, (url) => {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith("/messages")) {
      return json(200, { list: [message("m-1", "nuevo")], hasMore: false });
    }
    const offset = Number(parsed.searchParams.get("offset"));
    const start = offset + 1;
    return json(200, {
      list: Array.from({ length: 20 }, (_, index) => thread(String(start + index))),
      hasMore: true,
    });
  }), { listCap: 60, openThreadKeys: ["30"] });
  const messages = urls.filter((url) => url.includes("/messages"));
  assert.equal(messages.some((url) => url.includes("/chats/30/messages")), true);
  assert.equal(messages.some((url) => url.includes("/chats/6/messages")), false);
  const listAt = urls.findIndex((url) => url.includes("/api2/v2/chats?"));
  const openAt = urls.findIndex((url) => url.includes("/chats/30/messages"));
  assert.equal(openAt >= 0 && openAt < listAt, true);
});

test("el cursor de mensajes pide otra página y no el chat entero", async () => {
  const urls: string[] = [];
  await fetchSignedChats(state(), deps(urls, (url) => {
    const parsed = new URL(url);
    if (!parsed.pathname.endsWith("/messages")) {
      return json(200, { list: [thread("1")], hasMore: false });
    }
    const cursor = parsed.searchParams.get("id");
    if (!cursor) return json(200, { list: [message("100", "nuevo"), message("90", "antes")], hasMore: true });
    if (cursor === "90") return json(200, { list: [message("80", "viejo")], hasMore: true });
    return json(200, { list: [message("70", "demasiado")], hasMore: true });
  }), { openThreadKeys: ["7"], messagePageCap: 2, listCap: 20 });
  const pages = urls.filter((url) => url.includes("/chats/7/messages"));
  assert.equal(pages.length, 2);
  assert.equal(pages[1]?.includes("id=90"), true);
  assert.equal(urls.some((url) => url.includes("id=80")), false);
});

test("un 401 devuelve un motivo y no llama a ningún BrowserFactory", async () => {
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
  const urls: string[] = [];
  const read = await fetchSignedChats(state(), {
    ...deps(urls, () => json(401, { error: "unauthorized" })),
    browsers,
  });
  assert.equal(launches, 0);
  assert.equal(read.sessionRejected, true);
  assert.match(read.reason ?? "", /401/);
  assert.match(read.reason ?? "", /Reconectar/);
  assert.equal(read.threads.length, 0);
  assert.equal(urls.length, 1);
  assert.equal(urls.every((url) => url.startsWith("https://onlyfans.com/")), true);
});

test("un 429 dice cuánto esperar y no marca la sesión", async () => {
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
  const urls: string[] = [];
  const read = await fetchSignedChats(state(), {
    ...deps(urls, () => json(429, { error: "slow" }, { retryAfter: "3" })),
    browsers,
  });
  assert.equal(launches, 0);
  assert.equal(read.sessionRejected, false);
  assert.equal(read.retryAfterMs, 3_000);
  assert.match(read.reason ?? "", /429/);
});

test("las cookies rotadas se parsean y esta lectura no las guarda", async () => {
  const urls: string[] = [];
  const read = await fetchSignedChats(state(), deps(urls, (url) => json(200, {
    list: [thread("1")],
    hasMore: false,
  }, url.includes("/api2/v2/chats?") ? {
    setCookie: [
      "sess=rotada; Domain=.onlyfans.com; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=60",
      "otra=no; Domain=example.com; Path=/",
    ],
  } : undefined)), { listCap: 20 });
  assert.equal(read.rotatedCookies.length, 1);
  assert.equal(read.rotatedCookies[0]?.name, "sess");
  assert.equal(read.rotatedCookies[0]?.value, "rotada");
  assert.equal(read.rotatedCookies[0]?.httpOnly, true);
  const foreign = parseSetCookieLine("otra=no; Domain=example.com; Path=/", 1_700_000_000_000);
  assert.equal(foreign, null);
});

function deps(urls: string[], respond: (url: string) => Response): SignedChatDeps {
  return {
    rules,
    now: () => 1_700_000_000_000,
    fetch: (async (input: RequestInfo | URL) => {
      const url = String(input);
      urls.push(url);
      return respond(url);
    }) as typeof fetch,
  };
}

function json(status: number, body: unknown, extra?: { retryAfter?: string; setCookie?: string[] }): Response {
  const headers = {
    get(name: string) {
      if (name.toLowerCase() === "retry-after") return extra?.retryAfter ?? null;
      return null;
    },
    getSetCookie() {
      return extra?.setCookie ?? [];
    },
  };
  return {
    status,
    ok: status >= 200 && status < 300,
    headers,
    json: async () => body,
  } as unknown as Response;
}

function thread(id: string) {
  return {
    withUser: { id, name: `Fan ${id}` },
    lastMessage: { id: `p-${id}`, text: "previo", createdAt: "2026-11-12T00:00:00.000Z", fromUser: { id } },
    unreadMessagesCount: 0,
  };
}

function message(id: string, text: string) {
  return { id, text, createdAt: "2026-11-12T00:00:01.000Z", fromUser: { id: "fan" } };
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
