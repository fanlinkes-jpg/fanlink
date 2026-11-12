import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { parseSignRules, signOnlyfans } from "../sync/of-sign.ts";
import { sessionForApi } from "../sync/of-chat-api.ts";
import type { StorageStateFile } from "../sessions/storage-state.ts";

test("la firma usa la regla pública y no mete la cookie", () => {
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
  const hash = createHash("sha1").update(["param", "1700000000000", "/api2/v2/chats?limit=20", "42"].join("\n")).digest("hex");
  const checksum = hash.charCodeAt(0) + hash.charCodeAt(1) + 10;
  assert.equal(signed.time, "1700000000000");
  assert.equal(signed.sign, `1:${hash}:${Math.abs(checksum).toString(16)}:2`);
  assert.equal(signed.sign.includes("sess"), false);
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
