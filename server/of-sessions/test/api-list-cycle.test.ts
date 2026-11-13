import assert from "node:assert/strict";
import { test } from "node:test";
import { runApiListCycle, skipApiListNotice, type ApiListAccount, type ApiListRead } from "../sync/api-list-cycle.ts";
import { simulateChatReads } from "../sync/api-list-pace.ts";

const connected: ApiListAccount = { id: "acc-ok", creatorId: "3zk7kbr", status: "active", identityState: "verified", hasStorageState: true };
const rejected: ApiListAccount = { id: "acc-401", creatorId: "otra", status: "active", identityState: "verified", hasStorageState: true };
const missingA: ApiListAccount = { id: "acc-sin-1", creatorId: "sin1", status: "pending_login", identityState: "unavailable", hasStorageState: false };
const missingB: ApiListAccount = { id: "acc-sin-2", creatorId: "sin2", status: "active", identityState: "unavailable", hasStorageState: false };

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
  assert.deepEqual(cycle.read, ["otra", "3zk7kbr"]);
  assert.deepEqual(cycle.saved, ["3zk7kbr"]);
  assert.equal(cycle.lines.some((line) => line === "[fanlink:chat] api lista creator=3zk7kbr hilos=10 mensajes=34"), true);
  const denied = cycle.lines.find((line) => line.includes("401"));
  assert.equal(denied, "[fanlink:chat] api lista creator=otra account=acc-401: OnlyFans ha rechazado la sesión (401). Pulsa Reconectar.");
  assert.equal(cycle.lines.some((line) => line.includes("sin sesión guardada")), false);
});

test("tres cuentas y una sola con sesión: una petición por ciclo y ningún error", () => {
  const pending: ApiListAccount = { id: "acc-pend", creatorId: "pend", status: "pending_login", identityState: "unavailable", hasStorageState: false };
  const gone: ApiListAccount = { id: "acc-enoent", creatorId: "disco", status: "active", identityState: "unavailable", hasStorageState: false };
  const live: ApiListAccount = { id: "acc-ok", creatorId: "3zk7kbr", status: "active", identityState: "verified", hasStorageState: true };
  const seen = new Set<string>();
  const notices: string[] = [];
  let calls = 0;
  const readOf = (account: ApiListAccount): ApiListRead => {
    calls += 1;
    assert.equal(account.creatorId, "3zk7kbr");
    return { threadCount: 10, messageCount: 34, reason: null, ...quiet };
  };
  for (let cycle = 0; cycle < 2; cycle += 1) {
    const result = runApiListCycle([pending, gone, live], readOf, () => false);
    for (const account of [pending, gone]) {
      const notice = skipApiListNotice(account, seen);
      if (notice) notices.push(notice);
    }
    assert.deepEqual(result.read, ["3zk7kbr"]);
    assert.equal(result.lines.some((line) => /sin sesión|401|rechazó la firma/.test(line)), false);
  }
  assert.equal(calls, 2);
  assert.deepEqual(notices, [
    "[fanlink:chat] api lista creator=pend account=acc-pend: se omite (sin sesión guardada)",
    "[fanlink:chat] api lista creator=disco account=acc-enoent: se omite (sin sesión guardada)",
  ]);
  assert.equal(skipApiListNotice(pending, seen), null);
  assert.equal(skipApiListNotice(gone, seen), null);
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
  assert.equal(first.lines[0], "[fanlink:chat] api lista creator=3zk7kbr account=acc-400: OnlyFans rechazó la firma");
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
