import assert from "node:assert/strict";
import { test } from "node:test";
import { accountPause, backoffDelayMs, blockKind, clearAccountPauses, noteAccountBlock } from "../sync/backoff.ts";

test("403 y 429 pausan la cuenta con espera creciente y jitter", () => {
  clearAccountPauses();
  assert.equal(blockKind(403, ""), "403");
  assert.equal(blockKind(429, ""), "429");
  assert.equal(blockKind(200, "captcha"), "captcha");
  assert.equal(blockKind(200, "redirigido a login"), "login");
  const low = backoffDelayMs(0, () => 0);
  const high = backoffDelayMs(0, () => 1);
  assert.ok(high > low);
  assert.ok(backoffDelayMs(3, () => 0) > backoffDelayMs(1, () => 1));
  const delay = noteAccountBlock("cuenta", "429", 1_000, () => 0);
  const pause = accountPause("cuenta", 1_000);
  assert.equal(pause?.until, 1_000 + delay);
  assert.equal(accountPause("cuenta", 1_000 + delay), null);
  clearAccountPauses();
});
