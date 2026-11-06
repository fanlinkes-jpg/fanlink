import assert from "node:assert/strict";
import { test } from "node:test";
import { fanInsightModel } from "./fan-insights.ts";

test("la ficha no inventa gasto, propinas ni suscripción", () => {
  const empty = fanInsightModel({
    spentCents: null,
    tipsCents: null,
    status: null,
    expiresAt: null,
    renewAuto: null,
    subPriceCents: null,
    notes: "",
    transactions: [],
    ppvPrices: [],
  });
  assert.equal(empty.total, "Sin datos");
  assert.equal(empty.last, "Sin datos");
  assert.equal(empty.ppvAvg, "Sin datos");
  assert.equal(empty.tipAvg, "Sin datos");
  assert.equal(empty.max, "Sin datos");
  assert.equal(empty.price, "Sin datos");
  assert.equal(empty.notes, "Sin datos");
  const filled = fanInsightModel({
    spentCents: 1500,
    tipsCents: null,
    status: "active",
    expiresAt: "2026-12-01T00:00:00.000Z",
    renewAuto: true,
    subPriceCents: 1000,
    notes: "vip",
    transactions: [
      { occurredAt: "2026-11-01T00:00:00.000Z", grossCents: 200, kind: "tip" },
      { occurredAt: "2026-11-05T00:00:00.000Z", grossCents: 800, kind: "message" },
    ],
    ppvPrices: [500, 300],
  });
  assert.equal(filled.total, "$15.00");
  assert.match(filled.last, /\$8.00 · message · 2026-11-05/);
  assert.equal(filled.ppvTotal, "$8.00");
  assert.equal(filled.ppvAvg, "$4.00");
  assert.equal(filled.tipTotal, "$2.00");
  assert.equal(filled.max, "$8.00 · message · 2026-11-05");
  assert.match(filled.expires, /^Caduca: /);
  assert.equal(filled.renew, "On");
  assert.equal(filled.power, "Datos insuficientes");
  assert.equal(filled.chargeback, "Desconocido");
  assert.equal(filled.notes, "vip");
});
