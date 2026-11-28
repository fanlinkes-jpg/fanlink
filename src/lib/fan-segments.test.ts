import assert from "node:assert/strict";
import { test } from "node:test";
import { countSegments, fanSegments, isNewFan, matchesSegmentFilter, spendSegmentOf } from "./fan-segments.ts";

const now = new Date("2026-11-28T10:00:00Z");

test("tramos de gasto: Freeloader 0 $, Low 1–50, Spender 51–100, Top 101–200, Whale 201 o más", () => {
  assert.equal(spendSegmentOf(0), "freeloader");
  assert.equal(spendSegmentOf(1), "low");
  assert.equal(spendSegmentOf(5_000), "low");
  assert.equal(spendSegmentOf(5_001), "spender");
  assert.equal(spendSegmentOf(10_000), "spender");
  assert.equal(spendSegmentOf(10_001), "top");
  assert.equal(spendSegmentOf(20_000), "top");
  assert.equal(spendSegmentOf(20_001), "whale");
});

test("un importe entre dos enteros (p. ej. 50,50 $) va al tramo inferior de la frontera", () => {
  // 50,50 $ > 50 y ≤ 100 → Spender. 100,50 $ > 100 y ≤ 200 → Top. 200,50 $ > 200 → Whale.
  assert.equal(spendSegmentOf(5_050), "spender");
  assert.equal(spendSegmentOf(10_050), "top");
  assert.equal(spendSegmentOf(20_050), "whale");
});

test("sin gasto de OnlyFans no hay tramo: no se inventa un Freeloader", () => {
  assert.equal(spendSegmentOf(null), null);
  assert.equal(spendSegmentOf(undefined), null);
  assert.equal(spendSegmentOf(Number.NaN), null);
  assert.equal(spendSegmentOf(-1), null);
});

test("New: suscrito en los últimos 30 días", () => {
  assert.equal(isNewFan("2026-11-20T00:00:00Z", now), true);
  assert.equal(isNewFan("2026-10-29T10:00:00Z", now), true);
  assert.equal(isNewFan("2026-10-20T00:00:00Z", now), false);
  assert.equal(isNewFan(null, now), false);
  assert.equal(isNewFan("2026-12-01T00:00:00Z", now), false);
});

test("un fan puede ser Whale y New a la vez; el filtro 'all' deja pasar a todos", () => {
  const fan = { spentCents: 30_000, subscribedAt: "2026-11-25T00:00:00Z" };
  assert.deepEqual(fanSegments(fan, now), ["whale", "new"]);
  assert.equal(matchesSegmentFilter("new", fan, now), true);
  assert.equal(matchesSegmentFilter("low", fan, now), false);
  assert.equal(matchesSegmentFilter("freeloader", { spentCents: 0, subscribedAt: null }, now), true);
  assert.equal(matchesSegmentFilter("all", { spentCents: null, subscribedAt: null }, now), true);
});

test("recuento por segmento con los sin datos aparte del Freeloader", () => {
  const counts = countSegments([
    { spentCents: 30_000, subscribedAt: null },
    { spentCents: 15_000, subscribedAt: "2026-11-27T00:00:00Z" },
    { spentCents: null, subscribedAt: "2026-11-27T00:00:00Z" },
    { spentCents: 100, subscribedAt: null },
    { spentCents: 0, subscribedAt: null },
  ], now);
  assert.deepEqual(counts, { whale: 1, top: 1, spender: 0, low: 1, freeloader: 1, new: 2, unknown: 1 });
});
