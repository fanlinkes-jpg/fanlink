import assert from "node:assert/strict";
import { test } from "node:test";
import {
  SESSION_EXPIRED_LABEL,
  accountFigure,
  accountSessionNotices,
  applySignedRead,
  deriveConnectedFromLastRead,
  derivedConnectedIds,
  everyAccountBlocked,
  showsConnected,
  signedReadsBlocked,
  type SignedReadAccount,
} from "../sync/session-link.ts";

const loginRequired: SignedReadAccount = {
  sessionRejected: false,
  connection: "login_required",
  identityState: "unavailable",
  status: "active",
  identityHandle: null,
  identityReason: "OnlyFans pide iniciar sesión: pulsa Reconectar",
};

test("una cuenta en login_required con una lectura 200 queda conectada", () => {
  const patch = applySignedRead(loginRequired, 200);
  assert.ok(patch);
  assert.equal(patch.connection, "live");
  assert.equal(patch.status, "active");
  assert.equal(patch.sessionRejected, undefined);
  assert.equal(patch.identityState, "unavailable");
  const next = { ...loginRequired, ...patch, sessionRejected: loginRequired.sessionRejected };
  assert.equal(showsConnected(next), true);
});

test("un 200 con handle deja la identidad verificada y no inventa el handle", () => {
  const patch = applySignedRead({ ...loginRequired, identityHandle: "bigpoppa1111" }, 200);
  assert.equal(patch?.identityState, "verified");
  assert.equal(patch?.connection, "live");
});

test("un 200 no borra sessionRejected: la cuenta no vuelve sola", () => {
  const rejected: SignedReadAccount = { ...loginRequired, sessionRejected: true, status: "expired" };
  assert.equal(applySignedRead(rejected, 200), null);
  assert.equal(deriveConnectedFromLastRead(rejected, true), null);
  assert.equal(showsConnected({ ...rejected, connection: "live", status: "active" }), false);
});

test("un 401 marca sessionRejected si aún no lo estaba y no reescribe si ya lo está", () => {
  const first = applySignedRead(loginRequired, 401, { reason: "OnlyFans ha rechazado la sesión (401). Pulsa Reconectar." });
  assert.equal(first?.sessionRejected, true);
  assert.equal(first?.connection, "login_required");
  assert.equal(first?.status, "expired");
  assert.equal(first?.loginInProgress, false);
  const again = applySignedRead({ ...loginRequired, sessionRejected: true, status: "expired" }, 401, {
    reason: "cookie=no-imprimir",
  });
  assert.equal(again, null);
});

test("la lista, las notificaciones y los fans saltan rechazada o login_required", () => {
  assert.equal(signedReadsBlocked({ sessionRejected: true, connection: "live" }), true);
  assert.equal(signedReadsBlocked({ sessionRejected: false, connection: "login_required" }), true);
  assert.equal(signedReadsBlocked({ sessionRejected: false, connection: "live" }), false);
});

test("una cuenta rechazada no enseña un 0", () => {
  const rejected = { sessionRejected: true, connection: "login_required" as const };
  assert.equal(accountFigure(rejected, 0), SESSION_EXPIRED_LABEL);
  assert.notEqual(accountFigure(rejected, 0), 0);
  assert.equal(accountFigure(rejected, null), SESSION_EXPIRED_LABEL);
  assert.equal(everyAccountBlocked(
    [{ creatorId: "9ikis52", ...rejected }],
    ["9ikis52"],
  ), true);
  assert.equal(accountFigure({ sessionRejected: false, connection: "live" }, 4), 4);
  assert.deepEqual(accountSessionNotices(
    [
      { creatorId: "9ikis52", sessionRejected: true, connection: "login_required" },
      { creatorId: "3zk7kbr", sessionRejected: false, connection: "live" },
    ],
    ["9ikis52", "3zk7kbr"],
  ), [`9ikis52: ${SESSION_EXPIRED_LABEL}`]);
  assert.equal(everyAccountBlocked(
    [
      { creatorId: "9ikis52", sessionRejected: true, connection: "login_required" },
      { creatorId: "3zk7kbr", sessionRejected: false, connection: "live" },
    ],
    ["9ikis52", "3zk7kbr"],
  ), false);
});

test("derivar la conexión no incluye a la cuenta rechazada", () => {
  const rows = [
    { id: "acc-ok", creatorId: "3zk7kbr", ...loginRequired },
    { id: "acc-no", creatorId: "9ikis52", ...loginRequired, sessionRejected: true, status: "expired" as const },
  ];
  assert.deepEqual(derivedConnectedIds(rows, new Set(["3zk7kbr", "9ikis52"])), ["acc-ok"]);
  assert.equal(deriveConnectedFromLastRead(loginRequired, false), null);
  assert.equal(deriveConnectedFromLastRead(loginRequired, true)?.connection, "live");
});
