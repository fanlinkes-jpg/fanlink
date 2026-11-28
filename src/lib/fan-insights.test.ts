import assert from "node:assert/strict";
import { test } from "node:test";
import { fanInsightModel, spendRows, subscriptionStatus } from "./fan-insights.ts";

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
  assert.equal(filled.total, "$18.75");
  assert.equal(fanInsightModel({
    spentCents: 8477,
    tipsCents: null,
    status: null,
    expiresAt: null,
    renewAuto: null,
    subPriceCents: null,
    notes: "",
    transactions: [],
    ppvPrices: [],
  }).total, "$105.96");
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

test("caso Maik: desglose desde compras guardadas y estado desde la caducidad", () => {
  const now = new Date("2026-11-28T00:00:00.000Z");
  const model = fanInsightModel({
    spentCents: 3198,
    tipsCents: null,
    status: null,
    expiresAt: "2026-12-10T00:00:00.000Z",
    renewAuto: true,
    subPriceCents: 999,
    notes: "",
    now,
    transactions: [],
    ppvPrices: [],
    purchases: [{ sentAt: "2026-11-21T12:00:00.000Z", priceCents: 2499 }],
  });
  assert.equal(model.total, "$39.98");
  assert.equal(model.status, "Activa");
  assert.equal(model.price, "$9.99");
  assert.equal(model.ppvTotal, "$24.99");
  assert.equal(model.ppvAvg, "$24.99");
  assert.equal(model.last, "$24.99 · ppv · 2026-11-21");
  assert.equal(model.max, "$24.99 · ppv · 2026-11-21");
  assert.equal(model.lastAgo, "hace 6 d");
  assert.equal(model.tipTotal, "Sin datos");
  assert.equal(model.tipAvg, "Sin datos");
});

test("la caducidad pasada da Caducada y sin caducidad sigue Sin datos", () => {
  const now = new Date("2026-11-28T00:00:00.000Z");
  assert.equal(subscriptionStatus(null, "2026-11-01T00:00:00.000Z", now), "expired");
  assert.equal(subscriptionStatus(null, null, now), null);
  assert.equal(subscriptionStatus("active", "2026-11-01T00:00:00.000Z", now), "active");
});

test("la compra que ya es movimiento de mensaje no se cuenta dos veces", () => {
  const rows = spendRows(
    [{ occurredAt: "2026-11-21T11:00:00.000Z", grossCents: 2499, kind: "message" }],
    [{ sentAt: "2026-11-21T12:00:00.000Z", priceCents: 2499 }, { sentAt: "2026-11-22T12:00:00.000Z", priceCents: 500 }],
  );
  assert.equal(rows.length, 2);
});

test("PPV total y propinas salen del desglose de OnlyFans en bruto y solo si están todas las partes", () => {
  const base = { status: null, expiresAt: null, renewAuto: null, subPriceCents: null, notes: "", transactions: [], ppvPrices: [] };
  const model = fanInsightModel({ ...base, spentCents: 8000, tipsCents: 800, messagesCents: 1600 });
  assert.equal(model.tipTotal, "$10.00");
  assert.equal(model.ppvTotal, "$20.00");
  assert.equal(model.ppvAvg, "Sin datos");
  const derived = fanInsightModel({ ...base, spentCents: 8000, tipsCents: null, subscribesCents: 4000, messagesCents: 1600, postsCents: 0 });
  assert.equal(derived.tipTotal, "$30.00");
  const partial = fanInsightModel({ ...base, spentCents: 8000, tipsCents: null, subscribesCents: 4000, messagesCents: 1600, postsCents: null });
  assert.equal(partial.tipTotal, "Sin datos");
});
