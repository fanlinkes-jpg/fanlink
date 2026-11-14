import assert from "node:assert/strict";
import { test } from "node:test";
import { clearAccountChatPace, REQUEST_GAP_MS } from "../sync/api-list-pace.ts";
import { clearAccountPauses, noteAccountBlock, accountPause } from "../sync/backoff.ts";
import { clearFanSpendCache } from "../sync/fan-spend.ts";
import { parseSignRules, signOnlyfans } from "../sync/of-sign.ts";
import type { ReadSql } from "../sync/store.ts";
import { blockedVisibleSpend, canReadFanSpend, runVisibleFanSpend, spendReadsBlocked } from "../sync/visible-spend.ts";

const NOW = 1_700_000_000_000;
const rules = parseSignRules({
  static_param: "param",
  format: "1:{}:{:x}:2",
  checksum_indexes: [0, 1],
  checksum_constants: [4, 6],
  checksum_constant: 10,
  app_token: "token",
  remove_headers: ["user-id"],
});

test("readVisibleFanSpendView no llama si no hay permiso, hay pausa o la sesión está rechazada", () => {
  assert.equal(canReadFanSpend("owner", []), true);
  assert.equal(canReadFanSpend("member", ["mensajes"]), true);
  assert.equal(canReadFanSpend("member", []), false);
  assert.equal(spendReadsBlocked({ sessionRejected: true, identityState: "verified" }), true);
  assert.equal(spendReadsBlocked({ sessionRejected: false, identityState: "mismatch" }), true);
  assert.equal(spendReadsBlocked({ sessionRejected: false, identityState: "verified" }), false);
  assert.equal(blockedVisibleSpend(null, false, NOW), null);
  const paused = blockedVisibleSpend(NOW + 4_000, false, NOW);
  assert.equal(paused?.blocked, true);
  assert.equal(paused?.retryAfterMs, 4_000);
  assert.equal(blockedVisibleSpend(null, true, NOW)?.retryAfterMs, 0);
  noteAccountBlock("acc-pause", "429", NOW, () => 0);
  const row = accountPause("acc-pause", NOW);
  assert.ok(row);
  assert.equal(blockedVisibleSpend(row.until, false, NOW)?.blocked, true);
  clearAccountPauses();
});

test("la lectura visible firma, espera el ritmo, solo pisa un null y respeta el TTL", async () => {
  if (!rules) throw new Error("reglas");
  clearFanSpendCache();
  clearAccountChatPace();
  const seen: Array<{ path: string; sign: string; userId: string; method: string; time: string }> = [];
  const waits: number[] = [];
  const writes: unknown[][] = [];
  let rejected = 0;
  let now = NOW;
  const sql: ReadSql = {
    async query(text, params) {
      if (text.startsWith("update")) {
        assert.match(text, /spent_cents is null/);
        writes.push(params ?? []);
      }
      return [];
    },
  };
  const auth = { cookie: "auth_id=42; sess=ok", userId: "42", xBc: "huella" };
  try {
    const first = await runVisibleFanSpend({
      accountId: "acc-vis",
      creatorId: "3zk7kbr",
      fanIds: ["7", "8"],
      cardIds: ["3"],
      auth,
      rules,
      fetch: async (url, init) => {
        const path = new URL(String(url)).pathname + new URL(String(url)).search;
        const headers = init?.headers as Record<string, string>;
        seen.push({ path, sign: headers.sign ?? "", userId: headers["user-id"] ?? "", method: init?.method ?? "GET", time: headers.time ?? "" });
        if (path.includes("/subscriptions/subscribers")) return json(200, [{ id: 7, subscribedOnData: { totalSumm: 0 } }]);
        if (path.endsWith("/users/8")) return json(200, { id: 8, subscribedOnData: { totalSumm: 1.5 } });
        return json(200, { id: 8, name: "sin total" });
      },
      now: () => now,
      sleep: async (ms) => {
        waits.push(ms);
        now += ms;
      },
      sql,
      log: () => undefined,
      onSessionRejected: () => { rejected += 1; },
    });
    assert.equal(first.byFan["7"], 0);
    assert.equal(first.byFan["8"], 150);
    assert.equal(first.blocked, false);
    assert.deepEqual(writes, [
      ["3zk7kbr", "7", 0],
      ["3zk7kbr", "8", 150],
    ]);
    const userCall = seen.find((item) => item.path.endsWith("/users/8"));
    assert.equal(userCall?.method, "GET");
    assert.equal(userCall?.userId, "42");
    assert.equal(userCall?.sign, signOnlyfans(rules, userCall?.path ?? "", "42", Number(userCall?.time)).sign);
    assert.ok(waits.every((wait) => wait >= REQUEST_GAP_MS));
    const before = seen.length;
    const again = await runVisibleFanSpend({
      accountId: "acc-vis",
      creatorId: "3zk7kbr",
      fanIds: ["7", "8", "9"],
      cardIds: ["3"],
      auth,
      rules,
      fetch: async (url) => {
        const path = new URL(String(url)).pathname;
        seen.push({ path, sign: "", userId: "", method: "GET", time: "" });
        return json(200, { id: 9, name: "vacio" });
      },
      now: () => now,
      sleep: async () => undefined,
      sql,
      log: (line) => {
        assert.equal(line.includes("card=1"), true);
        assert.equal(line.includes("fan="), false);
      },
    });
    assert.equal(seen.length, before + 1);
    assert.equal(again.byFan["9"], null);
    const afterNull = seen.length;
    await runVisibleFanSpend({
      accountId: "acc-vis",
      creatorId: "3zk7kbr",
      fanIds: ["9"],
      auth,
      rules,
      fetch: async () => {
        seen.push({ path: "no", sign: "", userId: "", method: "GET", time: "" });
        return json(200, {});
      },
      now: () => now + 1_000,
      sleep: async () => undefined,
      sql,
    });
    assert.equal(seen.length, afterNull);
    seen.length = 0;
    writes.length = 0;
    const denied = await runVisibleFanSpend({
      accountId: "acc-401",
      creatorId: "3zk7kbr",
      fanIds: ["5"],
      auth,
      rules,
      fetch: async () => json(401, null),
      now: () => now,
      sleep: async () => undefined,
      sql,
      onSessionRejected: () => { rejected += 1; },
    });
    assert.equal(rejected, 1);
    assert.equal(writes.length, 0);
    assert.equal(denied.byFan["5"], undefined);
  } finally {
    clearFanSpendCache();
    clearAccountChatPace();
    clearAccountPauses();
  }
});

function json(status: number, body: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: () => null },
    json: async () => body,
    body: { cancel: async () => undefined },
  } as unknown as Response;
}
