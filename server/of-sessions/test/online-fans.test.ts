import assert from "node:assert/strict";
import { test } from "node:test";
import type { Page } from "playwright";
import type { StorageStateFile } from "../sessions/storage-state.ts";
import { parseSignRules } from "../sync/of-sign.ts";
import {
  ONLINE_SUBSCRIBERS_PATH,
  fetchSignedOnlineFans,
  onlineFansFromPayload,
  onlineReadFromPayload,
  readOnlineSubscribers,
  subscribersResponse,
} from "../sync/online-fans.ts";

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
  assert.deepEqual(rows, [{ fanKey: "1", fanName: "Arias Crazy", fanHandle: "arias_crazy1", avatarUrl: "https://cdn.example/a.jpg" }]);
  assert.equal(onlineFansFromPayload({ list: [{ id: 9, username: "duchamp", isOnline: false }] }, false).length, 1);
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
  assert.equal(onlineReadFromPayload(401, { list: [] }).reason, "OnlyFans ha rechazado la firma");
});

test("api2 firmada deja solo al que está en línea, el 401 es la firma y el 200 vacío no es un fallo", async () => {
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
          ],
        },
      });
    },
  });
  assert.equal(two.status, 200);
  assert.equal(two.reason, null);
  assert.deepEqual(two.fans.map((fan) => fan.fanHandle), ["duchampprivate"]);

  const denied = await fetchSignedOnlineFans(state, {
    now: () => 1,
    rules,
    fetch: async () => new Response("no", { status: 401 }),
  });
  assert.equal(denied.reason, "OnlyFans ha rechazado la firma");
  assert.equal(denied.fans.length, 0);
  assert.equal(denied.status, 401);

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
