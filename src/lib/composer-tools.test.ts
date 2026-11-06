import assert from "node:assert/strict";
import { test } from "node:test";
import { QUICK_EMOJIS, authorLabel, emojiRows, matchScripts, mentionToken, messagePriceCents, paymentLabel, priceChartLayout, purchasedPpvSeries, slashQuery, wrapSelection } from "./composer-tools.ts";

test("la cuadrícula rápida cabe en tres filas y el selector la incluye", () => {
  const rows = emojiRows(QUICK_EMOJIS, 12);
  assert.ok(rows.length >= 3 && rows.length <= 4);
  assert.equal(rows[0]?.[0], "🥰");
  assert.ok(QUICK_EMOJIS.includes("❤️"));
});

test("el atajo / busca guiones y no inventa uno si no hay", () => {
  assert.equal(slashQuery("hola"), null);
  assert.equal(slashQuery("hola /vip"), "vip");
  const hits = matchScripts([
    { id: "s1", title: "Saludo", keyword: "vip", steps: [{ text: "hola vip", price: 5 }] },
    { id: "s2", title: "Otro", keyword: "frio", steps: [{ text: "luego" }] },
  ], "vip");
  assert.equal(hits.length, 1);
  assert.equal(hits[0]?.text, "hola vip");
  assert.equal(hits[0]?.priceCents, 500);
  assert.deepEqual(matchScripts([], "vip"), []);
});

test("el formato, la mención y el precio no se inventan", () => {
  assert.equal(wrapSelection("hola", 0, 4, "*").value, "*hola*");
  assert.equal(mentionToken("@Ana"), "@Ana ");
  assert.equal(mentionToken(null), "@");
  assert.equal(paymentLabel({ fromFan: false, priceCents: 500, purchased: false }), "$5.00 no pagado");
  assert.equal(paymentLabel({ fromFan: false, priceCents: 500, purchased: true }), "$5.00 pagado");
  assert.equal(paymentLabel({ fromFan: false, priceCents: 500, purchased: null }), "$5.00 · Sin datos");
  assert.equal(paymentLabel({ fromFan: true, priceCents: 500, purchased: true }), null);
  assert.equal(authorLabel("Elena", false), "ELENA");
  assert.equal(authorLabel(null, false), "Cuenta");
});

test("el precio del mensaje es gratis o como mínimo 3 USD", () => {
  assert.deepEqual(messagePriceCents(""), { ok: true, cents: null });
  assert.deepEqual(messagePriceCents("Gratis"), { ok: true, cents: null });
  assert.deepEqual(messagePriceCents("$0"), { ok: true, cents: null });
  assert.deepEqual(messagePriceCents("2.99"), { ok: false });
  assert.deepEqual(messagePriceCents("1"), { ok: false });
  assert.deepEqual(messagePriceCents("abc"), { ok: false });
  assert.deepEqual(messagePriceCents("3"), { ok: true, cents: 300 });
  assert.deepEqual(messagePriceCents("5,50"), { ok: true, cents: 550 });
  assert.deepEqual(messagePriceCents("200"), { ok: true, cents: 20000 });
  assert.deepEqual(messagePriceCents("200.01"), { ok: false });
  assert.deepEqual(messagePriceCents("201"), { ok: false });
});

test("la gráfica solo pinta PPV comprados y no rellena huecos", () => {
  const empty = purchasedPpvSeries([
    { fromFan: false, purchased: false, priceCents: 9000, sentAt: "2026-11-02T00:00:00.000Z" },
    { fromFan: false, purchased: null, priceCents: 800, sentAt: "2026-11-02T00:00:00.000Z" },
    { fromFan: true, purchased: true, priceCents: 500, sentAt: "2026-11-01T00:00:00.000Z" },
  ]);
  assert.equal(empty.maxCents, null);
  assert.equal(empty.avgCents, null);
  assert.deepEqual(empty.points, []);
  assert.deepEqual(priceChartLayout(empty.points, 360, 128), []);

  const series = purchasedPpvSeries([
    { fromFan: false, purchased: true, priceCents: 1500, sentAt: "2026-11-03T00:00:00.000Z" },
    { fromFan: false, purchased: true, priceCents: 500, sentAt: "2026-11-01T00:00:00.000Z" },
    { fromFan: false, purchased: false, priceCents: 9000, sentAt: "2026-11-02T00:00:00.000Z" },
  ]);
  assert.equal(series.maxCents, 1500);
  assert.equal(series.avgCents, 1000);
  assert.deepEqual(series.points.map((point) => point.priceCents), [500, 1500]);
  const dots = priceChartLayout(series.points, 360, 128);
  assert.equal(dots[0]?.label, "$5");
  assert.equal(dots[1]?.label, "$15");
  assert.equal(dots[0]?.date, "01/11");
  assert.ok((dots[0]?.x ?? 0) < (dots[1]?.x ?? 0));
  assert.ok((dots[1]?.y ?? 0) < (dots[0]?.y ?? 0));
});
