import assert from "node:assert/strict";
import { test } from "node:test";
import { changeRatio, creatorReport } from "./creator-metrics.ts";

const NOW = new Date("2026-11-05T18:00:00.000Z");

test("el informe usa transacciones reales y deja el neto vacío si no viene", () => {
  const report = creatorReport({
    now: NOW,
    period: "month",
    earningsSynced: true,
    fansSynced: true,
    transactions: [
      { occurredAt: "2026-11-03T15:00:00.000Z", grossCents: 1000, netCents: 800, kind: "tip" },
      { occurredAt: "2026-10-20T15:00:00.000Z", grossCents: 500, netCents: null, kind: "subscription" },
    ],
    earnings: [],
    fans: [
      { status: "active", subscribedAt: "2026-11-02T00:00:00.000Z", renewAuto: true },
      { status: "active", subscribedAt: "2026-01-01T00:00:00.000Z", renewAuto: false },
      { status: "expired", subscribedAt: "2026-01-01T00:00:00.000Z", renewAuto: null },
    ],
  });
  assert.equal(report.grossCents, 1000);
  assert.equal(report.netCents, 800);
  assert.equal(report.previousGrossCents, 500);
  assert.equal(report.previousNetCents, null);
  assert.equal(report.activeFans, 2);
  assert.equal(report.newFans, 1);
  assert.equal(report.expiredFans, 1);
  assert.equal(report.renewalRatio, 0.5);
  assert.equal(report.arpuCents, 500);
  assert.equal(changeRatio(report.grossCents, report.previousGrossCents), 1);
});

test("sin sincronizar no inventa un cero", () => {
  const report = creatorReport({
    now: NOW,
    period: "day",
    earningsSynced: false,
    fansSynced: false,
    transactions: [],
    earnings: [],
    fans: [],
  });
  assert.equal(report.grossCents, null);
  assert.equal(report.netCents, null);
  assert.equal(report.activeFans, null);
  assert.equal(report.arpuCents, null);
  assert.equal(changeRatio(null, 0), null);
});
