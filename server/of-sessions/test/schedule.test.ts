import assert from "node:assert/strict";
import { test } from "node:test";
import {
  backoffMs,
  intervalMinFromEnv,
  marginMs,
  runSyncOnce,
  selectSyncAccount,
  type ScheduleAccount,
} from "../sync/schedule.ts";
import { publicSyncReason } from "../messages.ts";

const NOW = new Date("2026-11-05T12:00:00.000Z");
const INTERVAL = 30 * 60 * 1000;

function account(overrides: Partial<ScheduleAccount> = {}): ScheduleAccount {
  return {
    accountId: "a1",
    creatorId: "c1",
    status: "active",
    identityState: "unavailable",
    hasStorageState: true,
    consecutiveFailures: 0,
    lastAttemptAt: null,
    ...overrides,
  };
}

test("el intervalo por defecto es 30 minutos y se acota", () => {
  assert.equal(intervalMinFromEnv(undefined), 30);
  assert.equal(intervalMinFromEnv("15"), 15);
  assert.equal(intervalMinFromEnv("1"), 5);
  assert.equal(intervalMinFromEnv("9999"), 1440);
});

test("no lanza dos cuentas a la vez ni repite la que ya está en curso", async () => {
  let started = 0;
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const inProgressIds = new Set<string>();
  const accounts = [
    account({ accountId: "a1", creatorId: "c1" }),
    account({ accountId: "a2", creatorId: "c2" }),
  ];
  const first = runSyncOnce({
    now: NOW,
    intervalMs: INTERVAL,
    accounts,
    inProgressIds,
    async sync(accountId) {
      started += 1;
      assert.equal(accountId, "a1");
      await gate;
    },
  });
  const second = await runSyncOnce({
    now: NOW,
    intervalMs: INTERVAL,
    accounts,
    inProgressIds,
    async sync() {
      started += 1;
    },
  });
  assert.equal(second.ran, null);
  assert.equal(started, 1);
  release();
  assert.equal((await first).ran, "a1");
  assert.equal(inProgressIds.size, 0);
});

test("salta no coincide, caducada y pendiente; no verificada sí entra", () => {
  const pick = selectSyncAccount({
    now: NOW,
    intervalMs: INTERVAL,
    inProgressIds: new Set(),
    accounts: [
      account({ accountId: "bad", creatorId: "c-bad", identityState: "mismatch" }),
      account({ accountId: "old", creatorId: "c-old", status: "expired" }),
      account({ accountId: "wait", creatorId: "c-wait", status: "pending_login", hasStorageState: false }),
      account({ accountId: "ok", creatorId: "c-ok", identityState: "unavailable" }),
    ],
  });
  assert.equal(pick.accountId, "ok");
  assert.deepEqual(
    pick.skipped.map((item) => item.reason).sort(),
    ["expired", "mismatch", "pending"],
  );
});

test("la espera crece con los fallos seguidos y luego vuelve a tocar", () => {
  assert.equal(backoffMs(INTERVAL, 1), INTERVAL);
  assert.equal(backoffMs(INTERVAL, 2), INTERVAL * 2);
  assert.equal(backoffMs(INTERVAL, 3), INTERVAL * 4);
  assert.equal(backoffMs(INTERVAL, 8), INTERVAL * 16);

  const recent = new Date(NOW.getTime() - 60_000).toISOString();
  const held = selectSyncAccount({
    now: NOW,
    intervalMs: INTERVAL,
    inProgressIds: new Set(),
    accounts: [account({ consecutiveFailures: 3, lastAttemptAt: recent })],
  });
  assert.equal(held.accountId, null);
  assert.equal(held.skipped[0]?.reason, "backoff");

  const old = new Date(NOW.getTime() - INTERVAL * 4 - 1_000).toISOString();
  const ready = selectSyncAccount({
    now: NOW,
    intervalMs: INTERVAL,
    inProgressIds: new Set(),
    accounts: [account({ consecutiveFailures: 3, lastAttemptAt: old })],
  });
  assert.equal(ready.accountId, "a1");
});

test("la primera pasada no espera media hora", () => {
  const recent = new Date(NOW.getTime() - 60_000).toISOString();
  const held = selectSyncAccount({
    now: NOW,
    intervalMs: INTERVAL,
    inProgressIds: new Set(),
    accounts: [account({ lastAttemptAt: recent })],
  });
  assert.equal(held.accountId, null);
  const forced = selectSyncAccount({
    now: NOW,
    intervalMs: INTERVAL,
    inProgressIds: new Set(),
    ignoreCadence: true,
    accounts: [account({ lastAttemptAt: recent })],
  });
  assert.equal(forced.accountId, "a1");
  assert.equal(
    publicSyncReason("redirigido a login. json: https://onlyfans.com/my/statements/earnings"),
    "OnlyFans pide iniciar sesión: pulsa Reconectar",
  );
  assert.equal(publicSyncReason("sin respuesta de fans"), "sin respuesta de fans");
});

test("el margen entre cuentas sale del azar y no es cero", () => {
  assert.equal(marginMs(() => 0, 15_000, 90_000), 15_000);
  assert.equal(marginMs(() => 1, 15_000, 90_000), 90_000);
  const mid = marginMs(() => 0.5, 15_000, 90_000);
  assert.ok(mid > 15_000 && mid < 90_000);
});
