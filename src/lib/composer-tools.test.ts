import assert from "node:assert/strict";
import { test } from "node:test";
import { QUICK_EMOJIS, authorLabel, emojiRows, matchScripts, mentionToken, paymentLabel, slashQuery, wrapSelection } from "./composer-tools.ts";

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
