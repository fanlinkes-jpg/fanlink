import assert from "node:assert/strict";
import { test } from "node:test";
import { parseEarningsJson } from "../sync/parse.ts";

const NOW = new Date("2026-11-28T00:00:00.000Z");

test("entiende envoltorios nuevos de ingresos de OnlyFans", () => {
  const nested = parseEarningsJson({
    response: { payload: { points: [{ startDate: "2026-11-28", totalSumm: 12.5 }] } },
  }, NOW);
  assert.equal(nested.find((row) => row.kind === "total")?.amountCents, 1250);

  const byDay = parseEarningsJson({ chart: { "2026-11-27": 4, "2026-11-28": { income: 9 } } }, NOW);
  assert.equal(byDay.find((row) => row.day === "2026-11-27")?.amountCents, 400);
  assert.equal(byDay.find((row) => row.day === "2026-11-28")?.amountCents, 900);

  const pairs = parseEarningsJson({ series: [["2026-11-26", 3], ["2026-11-26", "$5.00"]] }, NOW);
  assert.equal(pairs.filter((row) => row.day === "2026-11-26").reduce((sum, row) => sum + row.amountCents, 0), 800);

  const odd = { chartAmount: [1, 2], secretName: "no-mostrar" };
  assert.equal(parseEarningsJson(odd, NOW).length, 0);
});
