import assert from "node:assert/strict";
import { test } from "node:test";
import { employeeMetricCells } from "./employee-metrics.ts";

test("un empleado sin sincronizar no enseña un cero ni 6 minutos", () => {
  const cells = employeeMetricCells(null);
  assert.deepEqual(cells, ["Sin datos", "Sin datos", "Sin datos", "Sin datos"]);
  assert.equal(cells.includes("0"), false);
  assert.equal(cells.some((cell) => cell.includes("6")), false);
  const synced = employeeMetricCells({ grossCents: null, ppvSent: null, firstReplyMinutes: null, threads: null });
  assert.deepEqual(synced, ["Sin datos", "Sin datos", "Sin datos", "Sin datos"]);
  const money = employeeMetricCells({ grossCents: 500, ppvSent: 1, firstReplyMinutes: 3, threads: 2 });
  assert.equal(money[0], "5.00 USD");
});
