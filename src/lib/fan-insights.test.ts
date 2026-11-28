import assert from "node:assert/strict";
import { test } from "node:test";
import { agoLabel, chargebackRisk, durationLabel, fanInsightModel, spendRows, spendingPower, subscriptionStatus } from "./fan-insights.ts";

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
  assert.equal(filled.total, "$10.00");
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
  assert.equal(filled.last, "PPV $8.00");
  assert.equal(filled.ppvTotal, "$8.00");
  assert.equal(filled.ppvAvg, "$4.00");
  assert.equal(filled.tipTotal, "$2.00");
  assert.equal(filled.max, "$8.00 · PPV · Nov 5, 2026");
  assert.match(filled.expires, /^Caduca: /);
  assert.equal(filled.renew, "On");
  assert.equal(filled.power, "Datos insuficientes");
  assert.equal(filled.chargeback, "Desconocido");
  assert.equal(filled.notes, "vip");
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

test("PPV total y propinas salen del desglose de OnlyFans en bruto", () => {
  const base = { status: null, expiresAt: null, renewAuto: null, subPriceCents: null, notes: "", transactions: [], ppvPrices: [] };
  const model = fanInsightModel({ ...base, spentCents: 8000, tipsCents: 800, messagesCents: 1600 });
  assert.equal(model.tipTotal, "$10.00");
  assert.equal(model.ppvTotal, "$20.00");
  assert.equal(model.ppvAvg, "Sin datos");
  assert.equal(model.total, "$30.00");
  const derived = fanInsightModel({ ...base, spentCents: 8000, tipsCents: null, subscribesCents: 4000, messagesCents: 1600, postsCents: 0 });
  assert.equal(derived.tipTotal, "$30.00");
});

test("sin gasto guardado no se inventa ni 0 ni total", () => {
  const model = fanInsightModel({ spentCents: null, tipsCents: null, status: null, expiresAt: null, renewAuto: null, subPriceCents: null, notes: "", transactions: [], ppvPrices: [] });
  assert.equal(model.tipTotal, "Sin datos");
  assert.equal(model.ppvTotal, "Sin datos");
  assert.equal(model.total, "Sin datos");
  assert.equal(model.chargeback, "Desconocido");
});

// Fan sintético con los números de Maik (@maik1234, Allison) frente a Infloww.
const MAIK = {
  spentCents: 3198, // neto de OnlyFans: 39.98 en bruto con la suscripción
  tipsCents: null,
  messagesCents: 1998, // neto: 24.98 en bruto
  status: null,
  expiresAt: "2026-12-14T10:00:00.000Z",
  subscribedAt: "2026-10-14T10:00:00.000Z",
  renewAuto: true,
  subPriceCents: 999,
  notes: "",
  now: new Date("2026-11-28T12:00:00.000Z"),
  transactions: [],
  ppvPrices: [],
  purchases: [{ sentAt: "2026-10-16T14:00:00.000Z", priceCents: 2499 }],
  rank: { fans: 188, above: 8, mineCents: 3198 },
  chargebacks: 0,
};

test("Maik: totales, último gasto, máximo, poder y contracargo como Infloww", () => {
  const model = fanInsightModel(MAIK);
  assert.equal(model.total, "$24.98");
  assert.equal(model.ppvTotal, "$24.98");
  assert.equal(model.ppvAvg, "$24.98");
  assert.equal(model.tipTotal, "$0.00");
  assert.equal(model.tipAvg, "-");
  assert.equal(model.lastAgo, "1m ago");
  assert.equal(model.last, "PPV $24.99");
  assert.equal(model.max, "$24.99 · PPV · Oct 16, 2026");
  assert.equal(model.power, "Top 5%");
  assert.equal(model.chargeback, "Low");
});

test("Maik: suscripción activa, $9.99, 1 mes y auto-renovación On", () => {
  const model = fanInsightModel(MAIK);
  assert.equal(model.status, "Activa");
  assert.equal(model.price, "$9.99");
  assert.equal(model.duration, "1 mes");
  assert.equal(model.renew, "On");
});

test("la misma compra como movimiento y como aviso no se cuenta dos veces", () => {
  const model = fanInsightModel({
    ...MAIK,
    transactions: [{ occurredAt: "2026-10-16T13:59:00.000Z", grossCents: 2499, kind: "message" }],
  });
  assert.equal(model.ppvAvg, "$24.98");
  assert.equal(spendRows([{ occurredAt: "2026-10-16T13:59:00.000Z", grossCents: 2499, kind: "message" }], MAIK.purchases).length, 1);
});

test("el tiempo relativo y la duración siguen el estilo de Infloww", () => {
  const now = new Date("2026-11-28T12:00:00.000Z");
  assert.equal(agoLabel("2026-11-28T11:55:00.000Z", now), "5min ago");
  assert.equal(agoLabel("2026-11-28T09:00:00.000Z", now), "3h ago");
  assert.equal(agoLabel("2026-11-16T12:00:00.000Z", now), "12d ago");
  assert.equal(agoLabel("2026-10-16T12:00:00.000Z", now), "1m ago");
  assert.equal(agoLabel("2024-11-01T12:00:00.000Z", now), "2y ago");
  assert.equal(durationLabel("2026-11-20T12:00:00.000Z", null, null, now), "8 días");
  assert.equal(durationLabel("2026-08-20T12:00:00.000Z", null, null, now), "3 meses");
  assert.equal(durationLabel(null, null, 1, now), "1 mes");
  assert.equal(durationLabel(null, null, null, now), "Sin datos");
});

test("poder de gasto y contracargo", () => {
  assert.equal(spendingPower({ fans: 188, above: 0, mineCents: 9 }), "Top 1%");
  assert.equal(spendingPower({ fans: 188, above: 187, mineCents: 0 }), "Top 100%");
  assert.equal(spendingPower({ fans: 3, above: 0, mineCents: 9 }), "Datos insuficientes");
  assert.equal(spendingPower(null), "Datos insuficientes");
  assert.equal(chargebackRisk(0, true), "Low");
  assert.equal(chargebackRisk(2, true), "High");
  assert.equal(chargebackRisk(null, true), "Desconocido");
});
