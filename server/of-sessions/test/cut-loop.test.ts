import assert from "node:assert/strict";
import { test } from "node:test";
import { cutSkipReason, pickCutAccount, pickOnlineAccount, type CutAccount } from "../sync/cut-loop.ts";

const HOURS = [0, 8, 16];
const NOW = new Date("2026-11-28T10:00:00Z"); // 11:00 Madrid, último corte 08:00

function account(over: Partial<CutAccount> = {}): CutAccount {
  return {
    accountId: "a1",
    creatorId: "c-alba",
    status: "active",
    identityState: "verified",
    hasStorageState: true,
    consecutiveFailures: 0,
    lastAttemptAt: "2026-11-28T06:00:00Z",
    allowed: true,
    paused: false,
    ...over,
  } as CutAccount;
}

test("solo lee cuentas de la allowlist", () => {
  assert.equal(cutSkipReason(account({ allowed: false }), NOW, HOURS), "not_allowed");
  assert.equal(pickCutAccount([account({ allowed: false })], NOW, HOURS), null);
});

test("cuenta en pausa por 429 o sesión caída: no se lee", () => {
  assert.equal(cutSkipReason(account({ paused: true }), NOW, HOURS), "paused");
  assert.equal(cutSkipReason(account({ sessionRejected: true }), NOW, HOURS), "blocked");
  assert.equal(cutSkipReason(account({ connection: "login_required" }), NOW, HOURS), "blocked");
  assert.equal(cutSkipReason(account({ status: "expired" as CutAccount["status"] }), NOW, HOURS), "blocked");
});

test("una lectura por corte: después del corte de las 08:00 ya no toca hasta las 16:00", () => {
  assert.equal(cutSkipReason(account(), NOW, HOURS), null);
  assert.equal(cutSkipReason(account({ lastAttemptAt: "2026-11-28T07:10:00Z" }), NOW, HOURS), "done");
});

test("backoff tras dos fallos seguidos", () => {
  assert.equal(cutSkipReason(account({ consecutiveFailures: 3, lastAttemptAt: "2026-11-28T06:59:00Z" }), new Date("2026-11-28T07:01:00Z"), HOURS), "backoff");
});

test("de una en una: primero la que lleva más tiempo sin leer", () => {
  const picked = pickCutAccount([
    account({ accountId: "b", lastAttemptAt: "2026-11-28T05:00:00Z" }),
    account({ accountId: "a", lastAttemptAt: "2026-11-27T20:00:00Z" }),
  ], NOW, HOURS);
  assert.equal(picked?.accountId, "a");
});

test("fans online entre cortes: apagado por defecto (0 minutos)", () => {
  assert.equal(pickOnlineAccount([account()], NOW, 0), null);
  assert.equal(pickOnlineAccount([account({ lastOnlineAt: "2026-11-28T09:00:00Z" })], NOW, 30)?.accountId, "a1");
  assert.equal(pickOnlineAccount([account({ lastOnlineAt: "2026-11-28T09:50:00Z" })], NOW, 30), null);
  assert.equal(pickOnlineAccount([account({ allowed: false })], NOW, 30), null);
});

import { startCutLoop } from "../sync/cut-loop.ts";

async function runLoop(firstCut: (() => Promise<boolean>) | undefined, accounts: CutAccount[]): Promise<{ synced: string[]; finished: number; started: number }> {
  const synced: string[] = [];
  let finished = 0;
  let started = 0;
  let ticks = 0;
  const loop = startCutLoop({
    hours: HOURS,
    onlineMin: 0,
    accounts: async () => accounts,
    sync: async (row) => {
      synced.push(row.accountId);
    },
    online: async () => undefined,
    firstCut,
    cutStarted: async () => {
      started += 1;
    },
    cutFinished: async () => {
      finished += 1;
    },
    now: () => NOW,
    sleep: async () => {
      ticks += 1;
      await new Promise((resolve) => setImmediate(resolve));
    },
    random: () => 0,
    marginMinMs: 1,
    marginMaxMs: 1,
    log: () => undefined,
  });
  while (ticks < 12) await new Promise((resolve) => setImmediate(resolve));
  loop.stop();
  return { synced, finished, started };
}

test("sin ningún corte guardado se lee al arrancar aunque ya hubiera un intento tras el último corte", async () => {
  const done = account({ lastAttemptAt: "2026-11-28T07:10:00Z" });
  const withFirst = await runLoop(async () => true, [done, account({ accountId: "a2", creatorId: "c-b", lastAttemptAt: "2026-11-28T07:20:00Z" })]);
  assert.deepEqual(withFirst.synced.sort(), ["a1", "a2"]);
  assert.equal(withFirst.started, 1);
  assert.equal(withFirst.finished, 1);
  const without = await runLoop(async () => false, [done]);
  assert.deepEqual(without.synced, []);
});

test("la lectura inicial respeta la allowlist, las pausas y las sesiones caídas", async () => {
  const result = await runLoop(async () => true, [
    account({ accountId: "x", allowed: false }),
    account({ accountId: "y", paused: true }),
    account({ accountId: "z", status: "expired" as CutAccount["status"] }),
  ]);
  assert.deepEqual(result.synced, []);
});

test("la lectura inicial lee cada cuenta una sola vez", async () => {
  const result = await runLoop(async () => true, [account({ lastAttemptAt: "2026-11-28T07:10:00Z" })]);
  assert.deepEqual(result.synced, ["a1"]);
});
