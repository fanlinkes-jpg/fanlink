import assert from "node:assert/strict";
import { test } from "node:test";
import type { StorageStateFile } from "../sessions/storage-state.ts";
import { fanListPath, fetchOfLists, normalizeFanListsRequest, parseOfLists, writeFanList } from "../sync/fan-lists-api.ts";
import type { SignRules } from "../sync/of-sign.ts";

const rules: SignRules = {
  staticParam: "param",
  format: "1:{}:{:x}:2",
  checksumIndexes: [0, 1],
  checksumConstants: [50, 50],
  checksumConstant: 100,
  appToken: "token",
  removeHeaders: ["user-id"],
};
const account = { creatorId: "c1", accountId: "a1", handle: "ana", userId: "42", label: "Ana" };

function state(): StorageStateFile {
  const cookie = (name: string, value: string) => ({ name, value, domain: ".onlyfans.com", path: "/", expires: -1, httpOnly: true, secure: true, sameSite: "Lax" as const });
  return {
    cookies: [cookie("auth_id", "42"), cookie("sess", "ok")],
    origins: [{ origin: "https://onlyfans.com", localStorage: [{ name: "bcTokenSha", value: "huella" }] }],
  };
}

function harness(status = 200, body: unknown = {}) {
  const calls: Array<{ method: string; path: string }> = [];
  const deps = {
    rules,
    now: () => 1_700_000_000_000,
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      calls.push({ method: (init?.method ?? "GET").toUpperCase(), path: url.pathname + url.search });
      return { status, ok: status >= 200 && status < 300, json: async () => body } as unknown as Response;
    }) as typeof fetch,
  };
  return { calls, deps };
}

test("las listas se leen del cuerpo de OnlyFans y solo con id y nombre", () => {
  const lists = parseOfLists({ list: [{ id: 7, name: "VIP" }, { id: "9", name: " Nuevos " }, { id: 1, name: "" }, { id: "x", name: "mal" }, { id: 3, name: "Fija", canAddUsers: false }], hasMore: false });
  assert.deepEqual(lists, [{ id: "7", name: "VIP" }, { id: "9", name: "Nuevos" }]);
  assert.deepEqual(parseOfLists(null), []);
});

test("la ruta de lista solo acepta ids numéricos", () => {
  assert.equal(fanListPath("7", "482191"), "/api2/v2/lists/7/users/482191");
  assert.equal(fanListPath("7/../x", "1"), null);
  assert.equal(fanListPath("7", "abc"), null);
});

test("leer las listas es un GET y no escribe", async () => {
  const { calls, deps } = harness(200, { list: [{ id: 7, name: "VIP" }] });
  const read = await fetchOfLists(state(), deps);
  assert.equal(read.ok, true);
  assert.deepEqual(read.lists, [{ id: "7", name: "VIP" }]);
  assert.deepEqual(calls, [{ method: "GET", path: "/api2/v2/lists?limit=100&offset=0&format=infinite" }]);
});

test("sin el gate de envío no se llama a OnlyFans", async () => {
  for (const [flag, allowlist] of [[undefined, "c1"], ["true", undefined], ["true", "otra"]] as const) {
    const { calls, deps } = harness();
    const result = await writeFanList({ flag, allowlist, account, state: state(), deps, listId: "7", fanId: "482191", add: true });
    assert.equal(result.ok, false);
    assert.equal(result.wrote, false);
    assert.equal(calls.length, 0);
  }
});

test("con el gate abierto añade con POST y quita con DELETE", async () => {
  const add = harness();
  const added = await writeFanList({ flag: "true", allowlist: "c1", account, state: state(), deps: add.deps, listId: "7", fanId: "482191", add: true });
  assert.equal(added.ok, true);
  assert.deepEqual(add.calls, [{ method: "POST", path: "/api2/v2/lists/7/users/482191" }]);
  const remove = harness();
  const removed = await writeFanList({ flag: "true", allowlist: "c1", account, state: state(), deps: remove.deps, listId: "7", fanId: "482191", add: false });
  assert.equal(removed.ok, true);
  assert.deepEqual(remove.calls, [{ method: "DELETE", path: "/api2/v2/lists/7/users/482191" }]);
});

test("un rechazo de OnlyFans no se da por hecho", async () => {
  const { deps } = harness(401);
  const result = await writeFanList({ flag: "true", allowlist: "c1", account, state: state(), deps, listId: "7", fanId: "482191", add: true });
  assert.equal(result.ok, false);
  assert.equal(result.wrote, false);
  assert.match(result.reason ?? "", /sesión/);
});

test("solo «lists» y «list» son peticiones válidas del menú", () => {
  assert.deepEqual(normalizeFanListsRequest({ action: "lists" }), { action: "lists" });
  assert.deepEqual(normalizeFanListsRequest({ action: "list", listId: "7", add: false }), { action: "list", listId: "7", add: false });
  for (const action of ["discount", "restrict", "block", "report"]) assert.equal(normalizeFanListsRequest({ action, percent: 10 }), null);
  assert.equal(normalizeFanListsRequest({ action: "list", listId: "x", add: true }), null);
});
