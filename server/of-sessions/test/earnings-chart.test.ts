import assert from "node:assert/strict";
import test from "node:test";
import { chartKindOf, outcomeFromParsed, parseEarningsJson, parseTransactions } from "../sync/parse.ts";

const NOW = new Date("2026-11-28T12:00:00Z");

// Forma publicada del gráfico: GET /api2/v2/earnings/chart?by=total
const CHART = {
  chartAmount: [
    { date: "2026-11-25T00:00:00+00:00", count: 40 },
    { date: "2026-11-26T00:00:00+00:00", count: 0 },
    { date: "2026-11-27T00:00:00+00:00", count: 80 },
  ],
  chartCount: [
    { date: "2026-11-25T00:00:00+00:00", count: 3 },
    { date: "2026-11-26T00:00:00+00:00", count: 0 },
    { date: "2026-11-27T00:00:00+00:00", count: 7 },
  ],
  total: 120,
  gross: 150,
  delta: 12.5,
};

test("el gráfico real (chartAmount/count) se lee en vez de dar «página cambiada»", () => {
  const rows = parseEarningsJson(CHART, NOW, { by: "total" });
  assert.equal(rows.length, 3);
  assert.ok(rows.every((row) => row.kind === "total"));
  // chartCount (operaciones) no se suma como dinero: 3 + 0 + 7 no aparece.
  assert.equal(rows.reduce((sum, row) => sum + row.amountCents, 0), 15000);
  assert.equal(outcomeFromParsed(rows.length, CHART), "ok");
});

test("el tipo sale del parámetro by y los días a cero son dato real", () => {
  const rows = parseEarningsJson(CHART, NOW, { by: "chat_messages" });
  assert.ok(rows.every((row) => row.kind === "message"));
  assert.equal(rows.find((row) => row.day === "2026-11-26")?.amountCents, 0);
  assert.equal(chartKindOf("subscribes"), "subscription");
  assert.equal(chartKindOf("ref"), "referral");
  assert.equal(chartKindOf("stream"), "stream");
  assert.equal(chartKindOf("otra_cosa"), null);
});

test("sin gross se guarda el valor tal cual", () => {
  const rows = parseEarningsJson({ chartAmount: [{ date: "2026-11-25T00:00:00+00:00", count: 12.5 }], total: 12.5 }, NOW, { by: "tips" });
  assert.deepEqual(rows.map((row) => [row.kind, row.amountCents]), [["tip", 1250]]);
});

test("la variante agregada trae un bloque por tipo", () => {
  const rows = parseEarningsJson(
    {
      total: { chartAmount: [{ date: "2026-11-25T00:00:00+00:00", count: 10 }], total: 10, gross: 10 },
      subscribes: { chartAmount: [{ date: "2026-11-25T00:00:00+00:00", count: 6 }], total: 6, gross: 6 },
      tips: { chartAmount: [{ date: "2026-11-25T00:00:00+00:00", count: 4 }], total: 4, gross: 4 },
      stream: { chartAmount: [], total: 0, gross: 0 },
    },
    NOW,
  );
  const byKind = Object.fromEntries(rows.map((row) => [row.kind, row.amountCents]));
  assert.deepEqual(byKind, { total: 1000, subscription: 600, tip: 400 });
});

test("un gráfico vacío reconocido no es un error", () => {
  const empty = { chartAmount: [], chartCount: [], total: 0, gross: 0 };
  assert.equal(parseEarningsJson(empty, NOW, { by: "total" }).length, 0);
  assert.equal(outcomeFromParsed(0, empty), "empty");
});

test("la forma antigua (puntos con date y total) sigue funcionando", () => {
  const rows = parseEarningsJson({ list: [{ date: "2026-11-25", subscriptions: 5, tips: 2 }] }, NOW);
  assert.deepEqual(rows.map((row) => [row.kind, row.amountCents]).sort(), [["subscription", 500], ["tip", 200]]);
});

test("movimientos: el tipo desconocido se deduce del texto, no se inventa", () => {
  const list = {
    list: [
      { id: 1, amount: 10, net: 8, createdAt: "2026-11-27T10:00:00+00:00", description: "Payment for message from Ana", user: { id: 77 } },
      { id: 2, amount: 5, net: 4, createdAt: "2026-11-27T11:00:00+00:00", type: "tip" },
      { id: 3, amount: 5, net: 4, createdAt: "2026-11-27T12:00:00+00:00", description: "Algo raro" },
    ],
  };
  const rows = parseTransactions(list, NOW);
  assert.deepEqual(rows.map((row) => [row.txKey, row.kind]), [["1", "message"], ["2", "tip"]]);
});

test("una lista de movimientos vacía sola no es un cero real; el gráfico vacío sí", async () => {
  const { earningsOutcomeFor } = await import("../sync/parse.ts");
  const emptyList = { list: [], hasMore: false };
  assert.equal(earningsOutcomeFor("https://onlyfans.com/api2/v2/payouts/transactions", 0, emptyList), "pending");
  assert.equal(earningsOutcomeFor("https://onlyfans.com/api2/v2/earnings/chart", 0, { chartAmount: [], total: 0 }), "empty");
  assert.equal(earningsOutcomeFor("https://onlyfans.com/api2/v2/earnings/chart", 3, CHART), "ok");
  assert.equal(earningsOutcomeFor("https://onlyfans.com/api2/v2/earnings/chart", 0, { algo: 1 }), "changed");
});
