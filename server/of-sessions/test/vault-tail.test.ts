import assert from "node:assert/strict";
import { test } from "node:test";
import { beginVaultTail, clearVaultPace, finishVaultTail, vaultPageWaitMs, vaultTailBusy, vaultTailLive } from "../sync/vault-pace.ts";

test("el hueco de una página de bóveda es 3 s más jitter y solo sigue una creadora", () => {
  clearVaultPace();
  assert.equal(vaultPageWaitMs(0), 3_000);
  assert.equal(vaultPageWaitMs(1), 4_500);
  assert.equal(vaultPageWaitMs(-3), 3_000);
  const first = beginVaultTail("allison");
  assert.equal(vaultTailBusy("allison"), true);
  assert.equal(vaultTailBusy("baby"), false);
  const second = beginVaultTail("baby");
  assert.equal(vaultTailLive(first), false);
  assert.equal(vaultTailLive(second), true);
  assert.equal(vaultTailBusy("baby"), true);
  finishVaultTail(first);
  assert.equal(vaultTailBusy("baby"), true);
  finishVaultTail(second);
  assert.equal(vaultTailBusy("baby"), false);
  clearVaultPace();
});
