import assert from "node:assert/strict";
import { test } from "node:test";
import { parseSignRules, signOnlyfans } from "../sync/of-sign.ts";
import { sessionForApi, signedHeaders } from "../sync/of-chat-api.ts";
import type { StorageStateFile } from "../sessions/storage-state.ts";

/**
 * Vector calculado con el algoritmo de referencia, no con esta función:
 * sha1("param\\n1700000000000\\n/api2/v2/chats?limit=20\\n0") y checksum
 * 10 + ord(hash[0]) + 50 + ord(hash[1]) + 50.
 * Fuentes: DATAHOARDERS/dynamic-rules onlyfans.json (remove_headers y
 * checksum_constants en paralelo); UltimaScraperAPI create_headers quita
 * user-id; Hashirama/OFDL create_sign firma con "0" y milisegundos.
 * El hex de abajo está fijado a mano: b7a3bd0d…:107.
 */
const VECTOR_SIGN = "1:b7a3bd0d7368462e6edae6c433abedb3c8a5fc29:107:2";

test("con remove_headers la firma usa 0 y las cabeceras no llevan user-id", () => {
  const rules = parseSignRules({
    static_param: "param",
    format: "1:{}:{:x}:2",
    checksum_indexes: [0, 1],
    checksum_constants: [50, 50],
    checksum_constant: 10,
    app_token: "token",
    remove_headers: ["user-id"],
  });
  assert.ok(rules);
  const signed = signOnlyfans(rules, "/api2/v2/chats?limit=20", "42", 1_700_000_000_000);
  assert.equal(signed.time, "1700000000000");
  assert.equal(signed.sign, VECTOR_SIGN);
  assert.equal(signed.sign.includes("sess"), false);
  const headers = signedHeaders(rules, "/api2/v2/chats?limit=20", {
    cookie: "auth_id=42; sess=secret",
    userId: "42",
    xBc: "huella",
  }, 1_700_000_000_000);
  assert.equal(headers["user-id"], undefined);
  assert.equal(headers["app-token"], "token");
  assert.equal(headers["x-bc"], "huella");
  assert.equal(headers.time, "1700000000000");
  assert.equal(headers.sign, VECTOR_SIGN);
  assert.equal(headers.sign.includes("secret"), false);
  const underscored = parseSignRules({
    static_param: "param",
    format: "1:{}:{:x}:2",
    checksum_indexes: [0, 1],
    checksum_constants: [50, 50],
    checksum_constant: 10,
    app_token: "token",
    remove_headers: ["user_id"],
  });
  assert.ok(underscored);
  const hidden = signedHeaders(underscored, "/api2/v2/chats?limit=20", {
    cookie: "auth_id=42; sess=secret",
    userId: "42",
    xBc: "huella",
  }, 1_700_000_000_000);
  assert.equal(hidden["user-id"], undefined);
  assert.equal(hidden.sign, VECTOR_SIGN);
});

test("checksum_constants cambia el checksum y sin quitar user-id se firma el id", () => {
  const base = {
    static_param: "param",
    format: "1:{}:{:x}:2",
    checksum_indexes: [0, 1],
    checksum_constant: 10,
    app_token: "token",
    remove_headers: ["user-id"],
  };
  const withConstants = parseSignRules({ ...base, checksum_constants: [50, 50] });
  const without = parseSignRules({ ...base, checksum_constants: [] });
  assert.ok(withConstants);
  assert.ok(without);
  const path = "/api2/v2/chats?limit=20";
  const stamped = signOnlyfans(withConstants, path, "42", 1_700_000_000_000);
  const plain = signOnlyfans(without, path, "42", 1_700_000_000_000);
  assert.equal(stamped.sign, VECTOR_SIGN);
  assert.notEqual(plain.sign, stamped.sign);
  const kept = parseSignRules({ ...base, checksum_constants: [50, 50], remove_headers: [] });
  assert.ok(kept);
  const named = signOnlyfans(kept, path, "42", 1_700_000_000_000);
  assert.notEqual(named.sign, VECTOR_SIGN);
  const headers = signedHeaders(kept, path, { cookie: "auth_id=42; sess=secret", userId: "42", xBc: "huella" }, 1_700_000_000_000);
  assert.equal(headers["user-id"], "42");
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
