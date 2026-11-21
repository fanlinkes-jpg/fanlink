import assert from "node:assert/strict";
import test from "node:test";
import { clearAccountChatPace, withAccountApi } from "../../server/of-sessions/sync/api-list-pace.ts";
import { accountPause, clearAccountPauses, noteAccountBlock } from "../../server/of-sessions/sync/backoff.ts";
import { shouldKickCreatorRead } from "./first-sync.ts";

test("la primera lectura no sale en pausa ni si la anterior es reciente", () => {
  const now = 1_700_000_000_000;
  noteAccountBlock("acc-kick", "429", now, () => 0);
  try {
    assert.equal(accountPause("acc-kick", now) != null, true);
    assert.equal(shouldKickCreatorRead({
      paused: accountPause("acc-kick", now) != null,
      lastAttemptAt: null,
      now,
      intervalMs: 60_000,
    }), false);
  } finally {
    clearAccountPauses();
  }
  assert.equal(shouldKickCreatorRead({
    paused: false,
    lastAttemptAt: new Date(now - 1_000).toISOString(),
    now,
    intervalMs: 60_000,
  }), false);
  assert.equal(shouldKickCreatorRead({ paused: false, lastAttemptAt: null, now, intervalMs: 60_000 }), true);
  assert.equal(shouldKickCreatorRead({
    paused: false,
    lastAttemptAt: new Date(now - 120_000).toISOString(),
    now,
    intervalMs: 60_000,
  }), true);
});

test("dos lecturas de la misma cuenta esperan el turno", async () => {
  clearAccountChatPace();
  let active = 0;
  let max = 0;
  const run = () => withAccountApi("acc-kick-pace", async () => {
    active += 1;
    max = Math.max(max, active);
    await new Promise((resolve) => setTimeout(resolve, 30));
    active -= 1;
  });
  await Promise.all([run(), run()]);
  assert.equal(max, 1);
});
