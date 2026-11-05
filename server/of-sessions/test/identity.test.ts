import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertAccountDataRead,
  identityFromDom,
  identityFromUserJson,
  isCurrentUserResponseUrl,
  judgeIdentityMatch,
  normalizeHandle,
} from "../identity.ts";

test("normaliza @ y mayúsculas al comparar el handle", () => {
  assert.equal(normalizeHandle("  @BigPoppa1111 "), "bigpoppa1111");
  assert.equal(judgeIdentityMatch("@BigPoppa1111", "bigpoppa1111"), "verified");
  assert.equal(judgeIdentityMatch("@bigpoppa1111", "otra"), "mismatch");
  assert.equal(judgeIdentityMatch("@bigpoppa1111", null), "unavailable");
  assert.equal(judgeIdentityMatch("   ", "bigpoppa1111"), "unavailable");
});

test("del JSON del usuario actual solo salen handle, nombre e id", () => {
  const read = identityFromUserJson({
    id: 42,
    username: "creadora",
    name: "Creadora de prueba",
    password: "no-guardar",
    cookie: "sess-secreta",
    token: "abc",
  });
  assert.deepEqual(read, { username: "creadora", name: "Creadora de prueba", userId: "42" });
  assert.equal(JSON.stringify(read).includes("no-guardar"), false);
  assert.equal(JSON.stringify(read).includes("sess-secreta"), false);
  assert.equal(identityFromUserJson({ user: { id: "7", username: "anidada", displayName: "Ana" } })?.name, "Ana");
  assert.equal(identityFromUserJson([{ username: "lista" }]), null);
  assert.equal(isCurrentUserResponseUrl("https://onlyfans.com/api2/v2/users/me"), true);
  assert.equal(isCurrentUserResponseUrl("https://onlyfans.com/api2/v2/users/99"), false);
});

test("el DOM solo aporta identidad si el adaptador declaró selector", () => {
  assert.equal(identityFromDom(undefined, { text: "Creadora", username: "creadora", userId: "42" }), null);
  assert.deepEqual(identityFromDom("#fanlink-identity", { text: "Creadora de prueba", username: "creadora", userId: "42" }), {
    username: "creadora",
    name: "Creadora de prueba",
    userId: "42",
  });
});

test("una identidad que no coincide bloquea lecturas de datos", () => {
  assert.doesNotThrow(() => assertAccountDataRead("verified"));
  assert.doesNotThrow(() => assertAccountDataRead("unavailable"));
  assert.throws(() => assertAccountDataRead("mismatch"), /bloqueadas/);
});
