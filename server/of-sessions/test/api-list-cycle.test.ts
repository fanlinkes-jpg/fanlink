import assert from "node:assert/strict";
import { test } from "node:test";
import { runApiListCycle, type ApiListAccount, type ApiListRead } from "../sync/api-list-cycle.ts";

const connected: ApiListAccount = { id: "acc-ok", creatorId: "3zk7kbr", status: "active", identityState: "verified" };
const rejected: ApiListAccount = { id: "acc-401", creatorId: "otra", status: "active", identityState: "verified" };
const missingA: ApiListAccount = { id: "acc-sin-1", creatorId: "sin1", status: "active", identityState: "unavailable" };
const missingB: ApiListAccount = { id: "acc-sin-2", creatorId: "sin2", status: "active", identityState: "unavailable" };

const reads: Record<string, ApiListRead> = {
  "acc-ok": { threadCount: 10, messageCount: 34, reason: null, sessionRejected: false, retryAfterMs: 0 },
  "acc-401": {
    threadCount: 0,
    messageCount: 0,
    reason: "OnlyFans ha rechazado la sesión (401). Pulsa Reconectar.",
    sessionRejected: true,
    retryAfterMs: 0,
  },
  "acc-sin-1": { threadCount: 0, messageCount: 0, reason: "sin sesión guardada", sessionRejected: false, retryAfterMs: 0 },
  "acc-sin-2": { threadCount: 0, messageCount: 0, reason: "sin sesión guardada", sessionRejected: false, retryAfterMs: 0 },
};

test("un 401 y dos cuentas sin sesión no tapan a la que sí lee", () => {
  const cycle = runApiListCycle(
    [rejected, missingA, missingB, connected],
    (account) => reads[account.id] ?? { threadCount: 0, messageCount: 0, reason: "sin hilos", sessionRejected: false, retryAfterMs: 0 },
    () => false,
  );
  assert.deepEqual(cycle.read, ["otra", "sin1", "sin2", "3zk7kbr"]);
  assert.deepEqual(cycle.saved, ["3zk7kbr"]);
  assert.equal(cycle.lines.some((line) => line === "[fanlink:chat] api lista creator=3zk7kbr hilos=10 mensajes=34"), true);
  const denied = cycle.lines.find((line) => line.includes("401"));
  assert.equal(denied, "[fanlink:chat] api lista cuenta=otra: OnlyFans ha rechazado la sesión (401). Pulsa Reconectar.");
  assert.equal(denied?.includes("3zk7kbr"), false);
  const missing = cycle.lines.filter((line) => line.includes("sin sesión guardada"));
  assert.deepEqual(missing, [
    "[fanlink:chat] api lista cuenta=sin1: sin sesión guardada",
    "[fanlink:chat] api lista cuenta=sin2: sin sesión guardada",
  ]);
  assert.equal(missing.some((line) => line.includes("3zk7kbr")), false);
});
