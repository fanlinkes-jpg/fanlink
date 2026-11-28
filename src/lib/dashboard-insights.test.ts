import assert from "node:assert/strict";
import { test } from "node:test";
import {
  chattersOf,
  creatorRowsOf,
  dailyRowsOf,
  insightAlertsOf,
  newSubsOf,
  salesOf,
  segmentsOf,
  summaryOf,
} from "./dashboard-insights.ts";
import { CUT, NOW, QUERY, fixture } from "./dashboard-insights.test-fixture.ts";

test("las ventas se cierran en el último corte: lo de después no cuenta todavía", () => {
  const sales = salesOf(fixture(), CUT);
  assert.equal(sales.some((sale) => sale.gross === 99_999), false);
  assert.equal(sales.length, 4);
});

test("neto por defecto (80 % si OnlyFans no da el neto) y bruto bajo demanda", () => {
  const net = summaryOf(fixture(), QUERY, CUT, NOW);
  assert.equal(net.kpis.total.value, 8_000 + 4_000 + 1_600);
  assert.equal(net.kpis.messages.value, 8_000);
  assert.equal(net.kpis.tips.value, 4_000);
  assert.equal(net.kpis.subs.value, 1_600);
  const gross = summaryOf(fixture(), { ...QUERY, basis: "gross" }, CUT, NOW);
  assert.equal(gross.kpis.total.value, 17_000);
});

test("% de cambio frente al periodo anterior y reparto por canal", () => {
  const view = summaryOf(fixture(), QUERY, CUT, NOW);
  assert.equal(view.kpis.total.previous, 40_000);
  assert.ok(Math.abs((view.kpis.total.change ?? 0) - (13_600 - 40_000) / 40_000) < 1e-9);
  const shares = Object.fromEntries(view.breakdown.map((row) => [row.channel, row.cents]));
  assert.equal(shares.messages, 8_000);
  assert.equal(shares.tips, 4_000);
  assert.equal(view.series.length, 7);
});

test("mejor día, mejor hora y CLV salen de las ventas reales", () => {
  const view = summaryOf(fixture(), QUERY, CUT, NOW);
  // 25/11/2026 es miércoles (índice 2, lunes = 0); 19:00Z = 20:00 Madrid.
  assert.equal(view.bestDay?.best, 2);
  assert.equal(view.bestHour?.best, 20);
  assert.ok(view.clv == null || view.clv.cents > 0);
  assert.equal(view.topFans[0]?.fanKey, "f1");
});

test("fans online: el último valor leído en el corte; sin lectura es Sin datos (null)", () => {
  const view = summaryOf(fixture(), QUERY, CUT, NOW);
  assert.equal(view.kpis.fansOnline.value, 15);
  const empty = summaryOf({ ...fixture(), snapshots: [] }, QUERY, CUT, NOW);
  assert.equal(empty.kpis.fansOnline.value, null);
});

test("tabla por creadora con % de cambio; reembolsos sin datos", () => {
  const { rows, cards } = creatorRowsOf(fixture(), QUERY, CUT);
  const alba = rows.find((row) => row.creatorId === "c-alba");
  assert.equal(alba?.values.total, 12_000);
  assert.ok((alba?.changes.total ?? 0) < 0);
  assert.equal(cards.creators, 2);
  assert.equal(cards.totalCents, 13_600);
  assert.equal(cards.refundCents, null);
});

test("comparativa diaria: un día por fila, del más reciente al más antiguo", () => {
  const rows = dailyRowsOf(fixture(), QUERY, CUT, NOW);
  assert.equal(rows.length, 7);
  assert.equal(rows[0]?.day, "2026-11-27");
});

test("chatters: venta atribuida a quien la hizo, PPV enviados/comprados y conversión", () => {
  const view = chattersOf(fixture(), QUERY, CUT, NOW);
  const chat = view.rows.find((row) => row.userId === "u-chat");
  assert.equal(chat?.salesCents, 8_000 + 4_000);
  assert.equal(chat?.ppvSent, 2);
  assert.equal(chat?.ppvBought, 1);
  assert.equal(chat?.conversion, 0.5);
  assert.equal(view.totalCents, 13_600);
  assert.equal(view.top[0]?.userId, "u-chat");
});

test("turnos: en turno, y retraso de más de 10 minutos", () => {
  const view = chattersOf(fixture(), QUERY, CUT, NOW);
  const byId = Object.fromEntries(view.shifts.map((row) => [row.userId, row.status]));
  assert.equal(byId["u-chat"], "on");
  assert.equal(byId["u-otro"], "late");
});

test("suscriptores nuevos: respuesta al mensaje de bienvenida, compra y segmentos", () => {
  const view = newSubsOf(fixture(), QUERY, CUT, NOW);
  assert.equal(view.count, 2);
  assert.equal(view.welcome?.replied, 1);
  assert.equal(view.welcome?.avgMinutes, 12);
  assert.equal(view.purchase?.bought, 1); // la suscripción sola no cuenta como compra
  assert.equal(view.purchase?.notBought, 1);
  assert.ok(view.duration);
});

test("segmentos de fans y alertas accionables", () => {
  const segments = segmentsOf(fixture(), NOW);
  assert.equal(segments.counts?.whale, 1);
  assert.equal(segments.counts?.new, 2);
  const alerts = insightAlertsOf(fixture(), QUERY, CUT, NOW, true);
  const whale = alerts.find((alert) => alert.kind === "whale");
  assert.deepEqual(whale?.action?.thread, { creatorId: "c-alba", fanKey: "f1" });
  assert.ok(alerts.some((alert) => alert.kind === "drop"));
  assert.ok(alerts.some((alert) => alert.kind === "shift"));
  assert.equal(insightAlertsOf(fixture(), QUERY, CUT, NOW, false).some((alert) => alert.kind === "drop"), false);
});

test("sin fans sincronizados: Sin datos, nunca ceros inventados", () => {
  const data = { ...fixture(), fansSyncedCreatorIds: [] };
  assert.equal(newSubsOf(data, QUERY, CUT, NOW).count, null);
  assert.equal(segmentsOf(data, NOW).counts, null);
});

test("un día que solo tiene el total de OnlyFans entra como «Sin desglosar»; con desglose manda el desglose", () => {
  const base = { ...fixture(), transactions: [] };
  const only = salesOf({ transactions: [], earnings: [{ creatorId: "c1", day: "2026-11-25", kind: "total", amountCents: 10_000 }] }, CUT);
  assert.deepEqual(only.map((sale) => [sale.channel, sale.gross]), [["other", 10_000]]);
  const typed = salesOf({
    transactions: [],
    earnings: [
      { creatorId: "c1", day: "2026-11-25", kind: "total", amountCents: 10_000 },
      { creatorId: "c1", day: "2026-11-25", kind: "subscription", amountCents: 6_000 },
      { creatorId: "c1", day: "2026-11-25", kind: "tip", amountCents: 4_000 },
    ],
  }, CUT);
  assert.deepEqual(typed.map((sale) => sale.channel).sort(), ["subs", "tips"]);
  assert.ok(base.creators.length > 0);
});
