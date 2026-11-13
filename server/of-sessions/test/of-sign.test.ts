import assert from "node:assert/strict";
import { test } from "node:test";
import { clearSignRulesCache, loadSignRules, parseSignRules, RULES_TIMEOUT_MS, signOnlyfans } from "../sync/of-sign.ts";
import { sessionForApi, signedHeaders } from "../sync/of-chat-api.ts";
import type { StorageStateFile } from "../sessions/storage-state.ts";

/**
 * Vector externo, no calculado por signOnlyfans.
 * sha1("param\\n1700000000000\\n/api2/v2/chats?limit=20\\n42"),
 * checksum = charCode(hash[0]) + charCode(hash[1]) + 10 = 113 = 0x71.
 * Algoritmo de 3064d53. checksum_constants no entra: checksum_constant ya es su suma.
 */
const VECTOR_SIGN = "1:347360f1fb69d4ffaa2e35bede98ca8e038f26d8:71:2";
const SIGN_WITH_ZERO = "1:b7a3bd0d7368462e6edae6c433abedb3c8a5fc29:107:2";

const QUERY = "/api2/v2/chats?limit=20";

function rulesJson(extra: Record<string, unknown> = {}) {
  return {
    static_param: "param",
    format: "1:{}:{:x}:2",
    checksum_indexes: [0, 1],
    checksum_constants: [4, 6],
    checksum_constant: 10,
    app_token: "token",
    remove_headers: ["user-id"],
    ...extra,
  };
}

test("una ruta con query firma el id real y no suma checksum_constants", () => {
  const rules = parseSignRules(rulesJson());
  assert.ok(rules);
  const signed = signOnlyfans(rules, QUERY, "42", 1_700_000_000_000);
  assert.equal(signed.time, "1700000000000");
  assert.equal(signed.sign, VECTOR_SIGN);
  assert.notEqual(signed.sign, SIGN_WITH_ZERO);
  assert.equal(signed.sign.includes("sess"), false);
  const headers = signedHeaders(rules, QUERY, {
    cookie: "auth_id=42; sess=secret",
    userId: "42",
    xBc: "huella",
  }, 1_700_000_000_000);
  assert.equal(headers["user-id"], "42");
  assert.equal(headers.sign, VECTOR_SIGN);
  assert.equal(headers["app-token"], "token");
  assert.equal(headers["x-bc"], "huella");
  assert.equal(headers.sign.includes("secret"), false);
});

test("sin query, remove_headers quita user-id y la firma usa 0", () => {
  const rules = parseSignRules(rulesJson());
  assert.ok(rules);
  const path = "/api2/v2/chats";
  const signed = signOnlyfans(rules, path, "42", 1_700_000_000_000);
  assert.notEqual(signed.sign, VECTOR_SIGN);
  const headers = signedHeaders(rules, path, {
    cookie: "auth_id=42; sess=secret",
    userId: "42",
    xBc: "huella",
  }, 1_700_000_000_000);
  assert.equal(headers["user-id"], undefined);
  assert.equal(headers.sign, signed.sign);
});

test("checksum_constants que no suman checksum_constant invalidan la regla", () => {
  assert.equal(parseSignRules(rulesJson({ checksum_constants: [50, 50], checksum_constant: 10 })), null);
  assert.ok(parseSignRules(rulesJson()));
  const bare = parseSignRules(rulesJson({ checksum_constants: [] }));
  assert.ok(bare);
  assert.equal(signOnlyfans(bare, QUERY, "42", 1_700_000_000_000).sign, VECTOR_SIGN);
});

test("GitHub caído o un JSON mal formado no tiran la última regla válida", async () => {
  clearSignRulesCache();
  let calls = 0;
  const fetchImpl = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    calls += 1;
    assert.ok(init?.signal);
    assert.equal(RULES_TIMEOUT_MS, 5_000);
    if (calls === 1) {
      return new Response(JSON.stringify(rulesJson()), { status: 200 });
    }
    if (calls === 2) throw new Error("github caído");
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  const first = await loadSignRules(fetchImpl, 0);
  const kept = await loadSignRules(fetchImpl, 31 * 60_000);
  assert.equal(kept.staticParam, first.staticParam);
  const still = await loadSignRules(fetchImpl, 62 * 60_000);
  assert.equal(still.appToken, "token");
  clearSignRulesCache();
  await assert.rejects(() => loadSignRules(fetchImpl, 0));
});

test("si GitHub falla, la regla guardada no se reintenta antes de 5 min", async () => {
  clearSignRulesCache();
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    if (calls === 1) return new Response(JSON.stringify(rulesJson()), { status: 200 });
    throw new Error("github caído");
  }) as typeof fetch;
  await loadSignRules(fetchImpl, 0);
  const kept = await loadSignRules(fetchImpl, 31 * 60_000);
  assert.equal(kept.appToken, "token");
  assert.equal(calls, 2);
  const quiet = await loadSignRules(fetchImpl, 31 * 60_000 + 60_000);
  assert.equal(quiet.staticParam, kept.staticParam);
  assert.equal(calls, 2);
  await loadSignRules(fetchImpl, 31 * 60_000 + 5 * 60_000);
  assert.equal(calls, 3);
  clearSignRulesCache();
});

test("una sola descarga de reglas a la vez", async () => {
  clearSignRulesCache();
  let calls = 0;
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const fetchImpl = (async () => {
    calls += 1;
    await gate;
    return new Response(JSON.stringify(rulesJson()), { status: 200 });
  }) as typeof fetch;
  const first = loadSignRules(fetchImpl, 0);
  const second = loadSignRules(fetchImpl, 0);
  release();
  const [left, right] = await Promise.all([first, second]);
  assert.equal(calls, 1);
  assert.equal(left.staticParam, right.staticParam);
  clearSignRulesCache();
});

test("sin x-bc no se llama a OnlyFans", () => {
  const state: StorageStateFile = {
    cookies: [
      cookie("auth_id", "42"),
      cookie("sess", "ok"),
    ],
    origins: [{ origin: "https://onlyfans.com", localStorage: [] }],
  };
  const missing = sessionForApi(state, Date.now());
  assert.equal("reason" in missing, true);
  const ready = sessionForApi({
    ...state,
    origins: [{ origin: "https://onlyfans.com", localStorage: [{ name: "bcTokenSha", value: "huella" }] }],
  }, Date.now());
  assert.equal("xBc" in ready && ready.xBc, "huella");
  if ("cookie" in ready) assert.equal(ready.cookie.includes("auth_id=42"), true);
});

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
