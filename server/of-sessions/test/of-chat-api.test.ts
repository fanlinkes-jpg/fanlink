import assert from "node:assert/strict";
import { test } from "node:test";
import { clearAccountChatPace, REQUEST_GAP_MS } from "../sync/api-list-pace.ts";
import type { StorageStateFile } from "../sessions/storage-state.ts";
import { clearSpendAsks, fetchSignedChats, parseSetCookieLine, type SignedChatDeps } from "../sync/of-chat-api.ts";
import { signOnlyfans, type SignRules } from "../sync/of-sign.ts";
import { spendTone } from "../../../src/lib/spend-tiers.ts";

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

test("la misma página con hasMore y sin nextOffset no se pide en bucle", async () => {
  const urls: string[] = [];
  const same = {
    list: Array.from({ length: 20 }, (_, index) => thread(String(index + 1))),
    hasMore: true,
  };
  const read = await fetchSignedChats(state(), deps(urls, () => json(200, same)), { listCap: 60, messages: "none" });
  const lists = urls.filter((url) => url.includes("/api2/v2/chats?"));
  assert.equal(lists.length, 2);
  assert.equal(read.threads.length, 20);
  assert.equal(lists.some((url) => new URL(url).searchParams.get("offset") === "40"), false);
});

test("un 429 dice cuánto esperar y no marca la sesión", async () => {
  const urls: string[] = [];
  const read = await fetchSignedChats(state(), deps(urls, () => json(429, { error: "slow" }, { retryAfter: "3" })));
  assert.equal(read.sessionRejected, false);
  assert.equal(read.signatureRejected, false);
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

test("un gasto 0 de users/list se guarda como $0.00 y si no viene totalSumm sigue en null", async () => {
  clearSpendAsks();
  clearAccountChatPace();
  const logs: string[] = [];
  const waits: number[] = [];
  let now = 1_700_000_000_000;
  const seen: Array<{ url: string; sign: string; userId: string }> = [];
  try {
    const zero = await fetchSignedChats(state(), spendDeps(seen, waits, () => now, (ms) => { now += ms; }, logs, (url) => {
      if (url.includes("/users/list")) return json(200, { "9": { id: "9", name: "Ana", subscribedOnData: { totalSumm: 0 } } });
      return json(200, { list: [thread("9")], hasMore: false });
    }), { listCap: 20, messages: "none" });
    assert.equal(zero.threads[0]?.spentCents, 0);
    assert.equal(spendTone(zero.threads[0]?.spentCents ?? null).label, "$0.00");
    const asked = seen.find((item) => item.url.includes("/users/list"));
    const path = `${new URL(asked?.url ?? "").pathname}${new URL(asked?.url ?? "").search}`;
    assert.equal(path, "/api2/v2/users/list?r[]=9");
    assert.equal(asked?.sign, signOnlyfans(rules, path, "42", now).sign);
    assert.equal(asked?.userId, "42");
    assert.deepEqual(waits, [REQUEST_GAP_MS]);
    assert.equal(logs[0], "[fanlink:spend] creator=3zk7kbr requested=1 filled=1 still null=0");
    assert.equal(logs[0]?.includes("r[]"), false);

    clearSpendAsks();
    clearAccountChatPace();
    now = 1_700_000_000_000;
    waits.length = 0;
    logs.length = 0;
    const missing = await fetchSignedChats(state(), spendDeps(seen, waits, () => now, (ms) => { now += ms; }, logs, (url) => {
      if (url.includes("/users/list")) return json(200, { "8": { id: "8", name: "Bo", subscribedOnData: { tipsSumm: 4 } } });
      return json(200, { list: [thread("8")], hasMore: false });
    }), { listCap: 20, messages: "none" });
    assert.equal(missing.threads[0]?.spentCents, null);
    assert.equal(spendTone(missing.threads[0]?.spentCents ?? null).label, "Sin datos");
    assert.equal(logs.at(-1), "[fanlink:spend] creator=3zk7kbr requested=1 filled=0 still null=1");
  } finally {
    clearSpendAsks();
    clearAccountChatPace();
  }
});

test("users/list va en tandas de 10, no repite un gasto que ya vino y un 429 para", async () => {
  clearSpendAsks();
  clearAccountChatPace();
  const urls: string[] = [];
  try {
    const many = await fetchSignedChats(state(), deps(urls, (url) => {
      if (!url.includes("/users/list")) {
        return json(200, { list: Array.from({ length: 11 }, (_, index) => thread(String(index + 1))), hasMore: false });
      }
      const ids = [...new URL(url).searchParams.getAll("r[]")];
      assert.ok(ids.length <= 10);
      return json(200, Object.fromEntries(ids.map((id) => [id, { id, name: id, subscribedOnData: { totalSumm: 1 } }])));
    }), { listCap: 20, messages: "none" });
    const lists = urls.filter((url) => url.includes("/users/list"));
    assert.equal(lists.length, 2);
    assert.equal(many.threads.every((thread) => thread.spentCents === 100), true);

    urls.length = 0;
    clearSpendAsks();
    await fetchSignedChats(state(), deps(urls, (url) => {
      if (url.includes("/users/list")) return json(200, { "2": { id: "2", subscribedOnData: { totalSumm: 3 } } });
      return json(200, {
        list: [
          { ...thread("1"), withUser: { id: "1", name: "Ya", subscribedOnData: { totalSumm: 0 } } },
          thread("2"),
        ],
        hasMore: false,
      });
    }), { listCap: 20, messages: "none" });
    const only = urls.filter((url) => url.includes("/users/list"));
    assert.equal(only.length, 1);
    assert.equal(new URL(only[0] ?? "").search, "?r[]=2");

    urls.length = 0;
    clearSpendAsks();
    const limited = await fetchSignedChats(state(), deps(urls, (url) => {
      if (url.includes("/users/list")) return json(429, { error: "slow" }, { retryAfter: "4" });
      return json(200, { list: [thread("4")], hasMore: false });
    }), { listCap: 20, messages: "none" });
    assert.equal(limited.retryAfterMs, 4_000);
    assert.equal(limited.threads[0]?.spentCents, null);
    assert.equal(urls.filter((url) => url.includes("/users/list")).length, 1);
  } finally {
    clearSpendAsks();
    clearAccountChatPace();
  }
});

function spendDeps(
  seen: Array<{ url: string; sign: string; userId: string }>,
  waits: number[],
  now: () => number,
  sleep: (ms: number) => void,
  logs: string[],
  respond: (url: string) => Response,
): SignedChatDeps {
  return {
    rules,
    creatorId: "3zk7kbr",
    accountId: "acc-spend",
    now,
    sleep: async (ms) => {
      waits.push(ms);
      sleep(ms);
    },
    log: (line) => logs.push(line),
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const headers = init?.headers as Record<string, string>;
      seen.push({ url, sign: headers.sign ?? "", userId: headers["user-id"] ?? "" });
      return respond(url);
    }) as typeof fetch,
  };
}

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
