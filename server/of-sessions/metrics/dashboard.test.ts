import assert from "node:assert/strict";
import { test } from "node:test";
import { dashboardAlerts } from "./dashboard.ts";

test("las alertas salen de sesión, sincronización, ballenas y caída", () => {
  const alerts = dashboardAlerts({
    sessions: [{ name: "Alba", status: "expired", connection: "login_required" }],
    syncs: [{ name: "Alba", status: "error", reason: "OnlyFans pide iniciar sesión: pulsa Reconectar" }],
    whalesAtRisk: ["Fan Uno"],
    drops: [{ name: "Alba" }],
  });
  assert.equal(alerts.length, 4);
  assert.equal(dashboardAlerts({ sessions: [], syncs: [], whalesAtRisk: [], drops: [] }).length, 0);
});
