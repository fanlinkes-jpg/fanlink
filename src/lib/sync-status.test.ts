import assert from "node:assert/strict";
import test from "node:test";
import { shortSyncReason, sourceLabel, syncStatusOf } from "./sync-status.ts";

const base = { earningsSyncedAt: null, fansSyncedAt: null, lastStatus: "idle" as const, lastReason: null };

test("chats y fuentes de dinero se cuentan por separado", () => {
  const status = syncStatusOf({
    ...base,
    chatSyncedAt: "2026-11-28T10:00:00.000Z",
    chatStatus: "ok",
    lastStatus: "error",
    lastReason: "página cambiada (ingresos). sin datos todavía (fans)",
  });
  assert.equal(status.chats.state, "ok");
  assert.equal(status.earnings.state, "error");
  assert.equal(status.earnings.reason, "página cambiada (ingresos)");
  assert.equal(status.fans.state, "error");
  assert.equal(status.fans.reason, "sin datos todavía (fans)");
});

test("un fallo solo de fans no tumba los ingresos buenos", () => {
  const status = syncStatusOf({
    ...base,
    earningsSyncedAt: "2026-11-28T08:00:00.000Z",
    lastStatus: "error",
    lastReason: "sin datos todavía (fans)",
  });
  assert.equal(status.earnings.state, "ok");
  assert.equal(status.fans.state, "error");
});

test("sin lectura ni error: Sin sincronizar, o no autorizada si la allowlist la deja fuera", () => {
  assert.equal(syncStatusOf(base).earnings.state, "none");
  const blocked = syncStatusOf({ ...base, readAllowed: false });
  assert.equal(blocked.earnings.state, "blocked");
  assert.match(sourceLabel(blocked.earnings), /FANLINK_READ_ALLOW_ACCOUNTS/);
});

test("el respaldo cuenta como dato parcial y lo dice", () => {
  const status = syncStatusOf({ ...base, earningsFallback: "notificaciones", fansFallback: "chats" });
  assert.equal(status.earnings.fallback, "notificaciones");
  assert.match(sourceLabel(status.earnings), /Parcial/);
  assert.match(sourceLabel(status.fans), /chats/);
});

test("un fallo genérico (login) afecta a las dos secciones y no enseña rutas", () => {
  const status = syncStatusOf({ ...base, lastStatus: "error", lastReason: "redirigido a login https://onlyfans.com/x" });
  assert.equal(status.earnings.state, "error");
  assert.equal(status.fans.state, "error");
  assert.equal(shortSyncReason("redirigido a login https://onlyfans.com/x"), "Sesión caducada: pulsa Reconectar");
});
