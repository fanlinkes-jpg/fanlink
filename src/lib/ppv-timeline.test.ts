import assert from "node:assert/strict";
import { test } from "node:test";
import { ppvTimeline } from "./ppv-timeline.ts";

test("el buy rate y la línea de PPV solo usan precios y compras reales", () => {
  const empty = ppvTimeline([
    { messageKey: "a", body: "hola", sentAt: "2026-11-06T10:00:00.000Z", fromFan: false, priceCents: null, purchased: null },
    { messageKey: "b", body: "fan", sentAt: "2026-11-06T11:00:00.000Z", fromFan: true, priceCents: 500, purchased: true },
  ]);
  assert.equal(empty.rate, "Sin datos");
  assert.equal(empty.high, "Sin datos");
  assert.equal(empty.rows.length, 0);
  const filled = ppvTimeline([
    { messageKey: "1", body: "set caro", sentAt: "2026-11-06T12:00:00.000Z", fromFan: false, priceCents: 1500, purchased: true, mediaCount: 2, mediaSeconds: 15, mediaPreview: "https://cdn.example/a.jpg" },
    { messageKey: "2", body: "set", sentAt: "2026-11-06T09:00:00.000Z", fromFan: false, priceCents: 500, purchased: false, mediaCount: null },
    { messageKey: "3", body: "duda", sentAt: "2026-11-06T08:00:00.000Z", fromFan: false, priceCents: 800, purchased: null },
  ]);
  assert.equal(filled.rate, "1/2 (50%)");
  assert.equal(filled.high, "$15.00");
  assert.equal(filled.low, "$5.00");
  assert.equal(filled.rows[0]?.state, "comprado");
  assert.equal(filled.rows[0]?.media, "2 medios · 15s");
  assert.equal(filled.rows[0]?.preview, "https://cdn.example/a.jpg");
  assert.equal(filled.rows[1]?.state, "no comprado");
  assert.equal(filled.rows[2]?.state, "Sin datos");
  assert.equal(filled.rows[2]?.media, "Sin datos");
});
