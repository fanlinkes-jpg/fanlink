import assert from "node:assert/strict";
import { test } from "node:test";
import { dashboardAlerts, dashboardViewFor, type DashboardCreatorRead } from "./dashboard.ts";

test("el chatter ve los fans activos y ninguna cifra en euros", () => {
  const now = new Date("2026-11-06T12:00:00.000Z");
  const reads = [
    {
      ...read("c-alba", "Ana", 50_000, false, "ok"),
      earningsSyncedAt: "2026-11-06T12:00:00.000Z",
      earnings: [{ day: "2026-11-05", kind: "total", amountCents: 80_000 }],
      fans: [
        fan("Ana", 50_000, false),
        fan("Luis", 100, true),
      ],
      transactions: [{ occurredAt: "2026-11-05T10:00:00.000Z", grossCents: 80_000, netCents: 70_000, kind: "tip" }],
    },
    {
      ...read("c-nora", "Ballena", 90_000, false, "ok"),
      earningsSyncedAt: "2026-11-06T12:00:00.000Z",
      earnings: [{ day: "2026-11-05", kind: "total", amountCents: 900_000 }],
      transactions: [{ occurredAt: "2026-11-05T10:00:00.000Z", grossCents: 900_000, netCents: 800_000, kind: "tip" }],
    },
  ];
  const accounts = [
    { id: "acc-alba", creatorId: "c-alba", label: "Alba", status: "active", connection: "live" },
    { id: "acc-nora", creatorId: "c-nora", label: "Nora", status: "active", connection: "live" },
  ];
  const chatter = dashboardViewFor({
    access: { role: "member", creatorIds: ["c-alba"] },
    accounts,
    reads,
    pauses: [],
    now,
  });
  assert.equal(chatter.activeFans, 2);
  assert.equal(chatter.dayGrossCents, null);
  assert.equal(chatter.monthGrossCents, null);
  assert.equal(chatter.alerts.some((alert) => alert.kind === "whale" || alert.kind === "drop"), false);
  assert.equal(JSON.stringify(chatter).includes("80000"), false);
  assert.equal(JSON.stringify(chatter).includes("900000"), false);
  const owner = dashboardViewFor({
    access: { role: "owner", creatorIds: [] },
    accounts,
    reads,
    pauses: [],
    now,
  });
  assert.equal(owner.activeFans, 3);
  assert.equal(owner.monthGrossCents, 980_000);
});

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

test("listDashboardView no incluye una cuenta ajena", () => {
  const reads = [
    read("c-alba", "Ana", 1_500, true, "error"),
    read("c-nora", "Ballena", 50_000, false, "ok"),
  ];
  const accounts = [
    { id: "acc-alba", creatorId: "c-alba", label: "Alba", status: "active", connection: "live" },
    { id: "acc-nora", creatorId: "c-nora", label: "Nora", status: "expired", connection: "login_required" },
  ];
  const chatter = dashboardViewFor({
    access: { role: "member", creatorIds: ["c-alba"] },
    accounts,
    reads,
    pauses: [{ accountId: "acc-nora", reason: "pausa ajena" }],
    now: new Date("2026-11-06T12:00:00.000Z"),
  });
  assert.equal(chatter.role, "member");
  assert.equal(chatter.dayGrossCents, null);
  assert.equal(chatter.monthGrossCents, null);
  assert.equal(chatter.activeFans, 1);
  assert.equal(chatter.alerts.some((alert) => alert.text.includes("Nora") || alert.text.includes("Ballena") || alert.text.includes("pausa ajena")), false);
  assert.equal(chatter.alerts.some((alert) => alert.text.includes("Alba")), true);
  const owner = dashboardViewFor({
    access: { role: "owner", creatorIds: [] },
    accounts,
    reads,
    pauses: [{ accountId: "acc-nora", reason: "pausa ajena" }],
    now: new Date("2026-11-06T12:00:00.000Z"),
  });
  assert.equal(owner.alerts.some((alert) => alert.text.includes("Nora")), true);
  assert.equal(owner.alerts.some((alert) => alert.text.includes("Ballena")), true);
  assert.equal(owner.activeFans, 2);
});

function fan(name: string, spentCents: number, renewAuto: boolean): DashboardCreatorRead["fans"][number] {
  return {
    fanKey: name,
    handle: null,
    displayName: name,
    spentCents,
    renewAuto,
    status: "active",
    subscribedAt: null,
  };
}

function read(creatorId: string, name: string, spentCents: number, renewAuto: boolean, lastStatus: string): DashboardCreatorRead {
  return {
    creatorId,
    earningsSyncedAt: null,
    fansSyncedAt: "2026-11-06T12:00:00.000Z",
    lastStatus,
    lastReason: "página cambiada",
    earnings: [],
    fans: [
      {
        fanKey: name,
        handle: null,
        displayName: name,
        spentCents,
        renewAuto,
        status: "active",
        subscribedAt: null,
      },
    ],
    transactions: [],
  };
}
