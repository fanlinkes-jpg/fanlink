import assert from "node:assert/strict";
import { test } from "node:test";
import { runApiListCycle, type ApiListAccount, type ApiListRead } from "../sync/api-list-cycle.ts";
import { simulateChatReads } from "../sync/api-list-pace.ts";

const connected: ApiListAccount = { id: "acc-ok", creatorId: "3zk7kbr", status: "active", identityState: "verified" };
const rejected: ApiListAccount = { id: "acc-401", creatorId: "otra", status: "active", identityState: "verified" };
const missingA: ApiListAccount = { id: "acc-sin-1", creatorId: "sin1", status: "active", identityState: "unavailable" };
const missingB: ApiListAccount = { id: "acc-sin-2", creatorId: "sin2", status: "active", identityState: "unavailable" };

const quiet = { sessionRejected: false, signatureRejected: false, retryAfterMs: 0 };
const reads: Record<string, ApiListRead> = {
  "acc-ok": { threadCount: 10, messageCount: 34, reason: null, ...quiet },
  "acc-401": {
    threadCount: 0,
    messageCount: 0,
    reason: "OnlyFans ha rechazado la sesión (401). Pulsa Reconectar.",
    sessionRejected: true,
    signatureRejected: false,
    retryAfterMs: 0,
  },
  "acc-sin-1": { threadCount: 0, messageCount: 0, reason: "sin sesión guardada", ...quiet },
  "acc-sin-2": { threadCount: 0, messageCount: 0, reason: "sin sesión guardada", ...quiet },
};

test("un 401 y dos cuentas sin sesión no tapan a la que sí lee", () => {
  const cycle = runApiListCycle(
    [rejected, missingA, missingB, connected],
    (account) => reads[account.id] ?? { threadCount: 0, messageCount: 0, reason: "sin hilos", ...quiet },
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

test("un 400 pausa la cuenta y no la vuelve a leer en el ciclo siguiente", () => {
  const account: ApiListAccount = { id: "acc-400", creatorId: "3zk7kbr", status: "active", identityState: "verified" };
  const bad: ApiListRead = {
    threadCount: 0,
    messageCount: 0,
    reason: "OnlyFans rechazó la firma",
    sessionRejected: false,
    signatureRejected: true,
    retryAfterMs: 0,
  };
  const paused = new Set<string>();
  const first = runApiListCycle([account], () => bad, (id) => paused.has(id));
  assert.equal(first.backoff[0], "acc-400");
  assert.match(first.lines[0] ?? "", /OnlyFans rechazó la firma/);
  assert.equal(first.saved.length, 0);
  for (const id of first.backoff) paused.add(id);
  let reads = 0;
  const second = runApiListCycle([account], () => {
    reads += 1;
    return bad;
  }, (id) => paused.has(id));
  assert.equal(reads, 0);
  assert.equal(second.lines.length, 0);
});

test("veinte hilos abiertos piden menos de una ráfaga de 28 cada 2 s", () => {
  const minute = simulateChatReads({ openThreads: 20, fullPages: 3, durationMs: 60_000 });
  assert.equal(minute.fullRuns, 1);
  assert.ok(minute.headPages >= 1);
  assert.ok(minute.headPages <= 4);
  assert.ok(minute.requests < 28 * 30);
  assert.ok(minute.openSweeps < 30);
});
