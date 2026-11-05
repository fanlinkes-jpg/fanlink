import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertAccountDataRead,
  identityFailureReason,
  identityFromDom,
  identityFromMenu,
  identityFromStateCandidates,
  identityFromUserJson,
  isCurrentUserResponseUrl,
  jsonUrlWithoutSecrets,
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

test("acepta /users/me con prefijo y query, y la ruta guardada no lleva secretos", () => {
  const url = "https://onlyfans.com/api2/v2/users/me?view=full&appToken=no-guardar";
  assert.equal(isCurrentUserResponseUrl(url), true);
  assert.equal(jsonUrlWithoutSecrets(url), "https://onlyfans.com/api2/v2/users/me");
  assert.equal(jsonUrlWithoutSecrets("https://user:secret@onlyfans.com/api2/v2/users/me"), null);
  assert.equal(isCurrentUserResponseUrl("https://onlyfans.com/api2/v2/users/99"), false);
});

test("la razón de identidad no incluye query ni cuerpos", () => {
  const reason = identityFailureReason({
    sawUsersMe: false,
    usersMeUnreadable: false,
    usersMeMissingUsername: false,
    redirectedToLogin: false,
    jsonPaths: [
      "https://onlyfans.com/api2/v2/init",
      "https://onlyfans.com/api2/v2/users/me?appToken=no-guardar",
    ],
  });
  assert.match(reason, /no hubo respuesta users\/me/);
  assert.match(reason, /api2\/v2\/init/);
  assert.equal(reason.includes("appToken"), false);
  assert.equal(reason.includes("no-guardar"), false);
  assert.match(
    identityFailureReason({
      sawUsersMe: true,
      usersMeUnreadable: false,
      usersMeMissingUsername: true,
      redirectedToLogin: false,
      jsonPaths: [],
    }),
    /campo username ausente/,
  );
  assert.match(
    identityFailureReason({
      sawUsersMe: false,
      usersMeUnreadable: false,
      usersMeMissingUsername: false,
      redirectedToLogin: true,
      jsonPaths: [],
    }),
    /redirigido a login/,
  );
});

test("el estado de la página prefiere al usuario actual y no guarda secretos", () => {
  const read = identityFromStateCandidates([
    { username: "otra", name: "Otra", userId: "1", preferred: false, inList: true, markedCurrent: false },
    { username: "bigpoppa1111", name: "Big", userId: "7", preferred: true, inList: false, markedCurrent: true, password: "no-guardar" },
  ]);
  assert.deepEqual(read, { username: "bigpoppa1111", name: "Big", userId: "7" });
  assert.equal(JSON.stringify(read).includes("no-guardar"), false);
  assert.equal(
    identityFromStateCandidates([
      { username: "una", name: null, userId: null, preferred: false, inList: true, markedCurrent: false },
      { username: "dos", name: null, userId: null, preferred: false, inList: true, markedCurrent: false },
    ]),
    null,
  );
});

test("el menú usa un solo href de perfil o un solo @username", () => {
  assert.deepEqual(identityFromMenu(["/bigpoppa1111?ref=secret", "/posts", "https://onlyfans.com/my/profile"], []), {
    username: "bigpoppa1111",
    name: null,
    userId: null,
  });
  assert.equal(JSON.stringify(identityFromMenu(["/bigpoppa1111?ref=secret"], [])).includes("secret"), false);
  assert.equal(identityFromMenu(["/una", "/dos"], []), null);
  assert.deepEqual(identityFromMenu([], ["@BigPoppa1111"]), { username: "bigpoppa1111", name: null, userId: null });
  assert.equal(identityFromUserJson({ data: { user_name: "anidada", userId: "8", displayName: "Ana", password: "no-guardar" } })?.username, "anidada");
});

test("una identidad que no coincide bloquea lecturas de datos", () => {
  assert.doesNotThrow(() => assertAccountDataRead("verified"));
  assert.doesNotThrow(() => assertAccountDataRead("unavailable"));
  assert.throws(() => assertAccountDataRead("mismatch"), /bloqueadas/);
});
