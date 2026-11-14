import assert from "node:assert/strict";
import { test } from "node:test";
import { clearAccountPauses, noteAccountBlock } from "../sync/backoff.ts";
import { apiListStep, passApiListAccounts, type ApiListAccount, type ApiListRead } from "../sync/api-list-cycle.ts";
import type { CollectedChats } from "../sync/collect-chats.ts";

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
};

test("un 401 y dos cuentas sin sesión no tapan a la que sí lee", async () => {
  clearAccountPauses();
  const seen = new Set<string>();
  const lines: string[] = [];
  const read: string[] = [];
  await passApiListAccounts(reader((account) => {
    read.push(account.creatorId ?? account.id);
    return reads[account.id] ?? { threadCount: 0, messageCount: 0, reason: "sin hilos", ...quiet };
  }), [rejected, missingA, missingB, connected], seen, async (account, got) => {
    lines.push(apiListStep(account, stepOf(got)).line);
  }, (line) => lines.push(line));
  assert.deepEqual(read, ["otra", "3zk7kbr"]);
  assert.equal(lines.some((line) => line === "[fanlink:chat] api lista creator=3zk7kbr account=acc-ok hilos=10 mensajes=34"), true);
  assert.equal(
    lines.find((line) => line.includes("401")),
    "[fanlink:chat] api lista creator=otra account=acc-401: OnlyFans ha rechazado la sesión (401). Pulsa Reconectar.",
  );
  assert.equal(lines.filter((line) => line.includes("se omite")).length, 2);
  clearAccountPauses();
});

test("tres cuentas y una sola con sesión: una petición por ciclo y ningún error", async () => {
  clearAccountPauses();
  const pending: ApiListAccount = { id: "acc-pend", creatorId: "pend", status: "pending_login", identityState: "unavailable", hasStorageState: false };
  const gone: ApiListAccount = { id: "acc-enoent", creatorId: "disco", status: "active", identityState: "unavailable", hasStorageState: false };
  const live: ApiListAccount = { id: "acc-ok", creatorId: "3zk7kbr", status: "active", identityState: "verified", hasStorageState: true };
  const seen = new Set<string>();
  const lines: string[] = [];
  let calls = 0;
  const sessions = reader((account) => {
    calls += 1;
    assert.equal(account.creatorId, "3zk7kbr");
    return { threadCount: 10, messageCount: 34, reason: null, ...quiet };
  });
  for (let cycle = 0; cycle < 2; cycle += 1) {
    await passApiListAccounts(sessions, [pending, gone, live], seen, async (account, got) => {
      const step = apiListStep(account, stepOf(got));
      assert.equal(/sin sesión|401|rechazó la firma/.test(step.line), false);
      lines.push(step.line);
    }, (line) => lines.push(line));
  }
  assert.equal(calls, 2);
  assert.deepEqual(lines.filter((line) => line.includes("se omite")), [
    "[fanlink:chat] api lista creator=pend account=acc-pend: se omite (sin sesión guardada)",
    "[fanlink:chat] api lista creator=disco account=acc-enoent: se omite (sin sesión guardada)",
  ]);
  clearAccountPauses();
});

test("un 400 pausa la cuenta y no la vuelve a leer en el ciclo siguiente", async () => {
  clearAccountPauses();
  const account: ApiListAccount = { id: "acc-400", creatorId: "3zk7kbr", status: "active", identityState: "verified", hasStorageState: true };
  const seen = new Set<string>();
  const lines: string[] = [];
  let calls = 0;
  const sessions = reader(() => {
    calls += 1;
    noteAccountBlock(account.id, "400", Date.now(), () => 0);
    return {
      threadCount: 0,
      messageCount: 0,
      reason: "OnlyFans rechazó la firma",
      sessionRejected: false,
      signatureRejected: true,
      retryAfterMs: 0,
    };
  });
  await passApiListAccounts(sessions, [account], seen, async (row, got) => {
    lines.push(apiListStep(row, stepOf(got)).line);
  }, (line) => lines.push(line));
  assert.equal(calls, 1);
  assert.equal(lines[0], "[fanlink:chat] api lista creator=3zk7kbr account=acc-400: OnlyFans rechazó la firma");
  await passApiListAccounts(sessions, [account], seen, async () => {
    throw new Error("no debía leer");
  });
  assert.equal(calls, 1);
  clearAccountPauses();
});

test("al volver a omitir una cuenta que ya se leía, el aviso sale otra vez", async () => {
  clearAccountPauses();
  const account: ApiListAccount = { id: "acc-vuelve", creatorId: "3zk7kbr", status: "pending_login", identityState: "unavailable", hasStorageState: false };
  const seen = new Set<string>();
  const lines: string[] = [];
  const log = (line: string) => lines.push(line);
  const sessions = reader(() => ({ threadCount: 1, messageCount: 0, reason: null, ...quiet }));
  await passApiListAccounts(sessions, [account], seen, async () => undefined, log);
  await passApiListAccounts(sessions, [account], seen, async () => undefined, log);
  assert.equal(lines.filter((line) => line.includes("se omite")).length, 1);
  account.status = "active";
  account.hasStorageState = true;
  account.identityState = "verified";
  await passApiListAccounts(sessions, [account], seen, async () => undefined, log);
  account.status = "pending_login";
  account.hasStorageState = false;
  await passApiListAccounts(sessions, [account], seen, async () => undefined, log);
  assert.equal(lines.filter((line) => line.includes("se omite")).length, 2);
  clearAccountPauses();
});

function reader(readOf: (account: ApiListAccount) => ApiListRead) {
  return {
    async readPacedChats(accountId: string) {
      const account = { id: accountId, creatorId: null, status: "active" as const, identityState: "verified" };
      return collected(readOf({ ...account, creatorId: accountId === "acc-401" ? "otra" : "3zk7kbr" }));
    },
  };
}

function collected(read: ApiListRead): CollectedChats {
  return {
    threads: Array.from({ length: read.threadCount }, (_, index) => ({ threadKey: String(index) })) as CollectedChats["threads"],
    messages: Array.from({ length: read.messageCount }, (_, index) => ({ messageKey: String(index) })) as CollectedChats["messages"],
    reason: read.reason,
    jsonPaths: [],
    sessionRejected: read.sessionRejected,
    signatureRejected: read.signatureRejected,
    retryAfterMs: read.retryAfterMs,
  };
}

function stepOf(read: CollectedChats): ApiListRead {
  return {
    threadCount: read.threads.length,
    messageCount: read.messages.length,
    reason: read.reason,
    sessionRejected: read.sessionRejected === true,
    signatureRejected: read.signatureRejected === true,
    retryAfterMs: read.retryAfterMs ?? 0,
  };
}
