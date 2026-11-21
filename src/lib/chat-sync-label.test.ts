import assert from "node:assert/strict";
import test from "node:test";
import { chatSyncLabel, headerSyncLabel } from "./chat-sync-label.ts";

test("el chat distingue sin sesión, sincronizando y error", () => {
  assert.equal(chatSyncLabel({ hasSession: false, loginInProgress: false, status: null, reason: null, running: false }), "Sin sesión");
  assert.equal(chatSyncLabel({ hasSession: false, loginInProgress: true, status: null, reason: null, running: false }), "Sincronizando…");
  assert.equal(chatSyncLabel({ hasSession: true, loginInProgress: false, status: null, reason: null, running: false }), "Sincronizando…");
  assert.equal(chatSyncLabel({ hasSession: true, loginInProgress: false, status: "error", reason: "OnlyFans respondió 401", running: false }), "Error · OnlyFans respondió 401");
  assert.equal(chatSyncLabel({ hasSession: true, loginInProgress: false, status: "ok", reason: null, running: false }), "Sin conversaciones");
  assert.equal(headerSyncLabel({ hasSession: true, loginInProgress: false, status: "ok", reason: null, running: false }), "OK");
});
