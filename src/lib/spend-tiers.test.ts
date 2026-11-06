import assert from "node:assert/strict";
import { test } from "node:test";
import { spendTone } from "./spend-tiers.ts";

test("el gasto del fan cambia de color por tramo y el que falta sigue en Sin datos", () => {
  assert.deepEqual(spendTone(null), { label: "Sin datos", color: null });
  assert.equal(spendTone(0).label, "$0.00");
  assert.equal(spendTone(0).color, "#6d7585");
  assert.equal(spendTone(5_000).color, "#137333");
  assert.equal(spendTone(5_001).color, "#2456c7");
  assert.equal(spendTone(20_001).color, "#6d28d9");
  assert.equal(spendTone(100_001).color, "#a16207");
});
