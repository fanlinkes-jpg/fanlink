import assert from "node:assert/strict";
import { test } from "node:test";
import { bubbleBlocks, bubblePriceLabel } from "./chat-bubble.ts";

test("varios medios van en carrusel y el precio queda entre el medio y el texto", () => {
  const one = bubbleBlocks({ mediaCount: 1, priceCents: 500, body: "hola" });
  assert.equal(one.layout, "single");
  assert.deepEqual(one.blocks, ["media", "price", "text"]);
  const many = bubbleBlocks({ mediaCount: 3, priceCents: 900, body: "set" });
  assert.equal(many.layout, "carousel");
  assert.deepEqual(many.blocks, ["media", "price", "text"]);
  assert.equal(bubblePriceLabel({ priceCents: 900, purchased: false }), "$9.00 no pagado");
  assert.equal(bubblePriceLabel({ priceCents: 900, purchased: true }), "$9.00 pagado");
});

test("un masivo de otra creadora usa el mismo carrusel y el mismo precio", () => {
  const own = bubbleBlocks({ mediaCount: 4, priceCents: 1500, body: "promo" });
  const mass = bubbleBlocks({ mediaCount: 4, priceCents: 1500, body: "promo" });
  const received = bubbleBlocks({ mediaCount: 4, priceCents: 1500, body: "promo" });
  assert.deepEqual(mass, own);
  assert.deepEqual(received, own);
  assert.equal(mass.layout, "carousel");
  assert.equal(mass.blocks.indexOf("price"), mass.blocks.indexOf("media") + 1);
  assert.equal(mass.blocks.indexOf("text"), mass.blocks.indexOf("price") + 1);
  assert.equal(bubblePriceLabel({ priceCents: 1500, purchased: false }), "$15.00 no pagado");
});

import { bubbleText, mediaTags, pricePill, readState, tagLine } from "./chat-bubble.ts";

test("la pastilla del pie dice precio y estado, y no existe sin precio", () => {
  assert.deepEqual(pricePill({ priceCents: 1999, purchased: false }), { money: "$19.99", state: "no pagado", label: "No pagado" });
  assert.equal(pricePill({ priceCents: 1999, purchased: true })?.label, "Pagado");
  assert.equal(pricePill({ priceCents: 1999, purchased: null })?.state, "sin datos");
  assert.equal(pricePill({ priceCents: 0, purchased: null }), null);
  assert.equal(pricePill({ priceCents: null, purchased: false }), null);
});

test("las etiquetas se juntan sin repetir y se escriben con el nombre o @usuario", () => {
  const tags = mediaTags([
    { tags: [{ name: "Jason", username: "jason" }, { name: null, username: "pr" }] },
    { tags: [{ name: "Jason", username: "jason" }] },
    {},
  ]);
  assert.equal(tags.length, 2);
  assert.equal(tagLine(tags), "Jason · @pr");
  assert.equal(tagLine([]), null);
  assert.deepEqual(mediaTags(null), []);
});

test("el título solo sale en mensajes con medio o precio y si hay más texto", () => {
  assert.deepEqual(bubbleText("Sesión\nMira esto\nOtro", true), { title: "Sesión", paragraphs: ["Mira esto", "Otro"] });
  assert.deepEqual(bubbleText("Hola\nque tal", false), { title: null, paragraphs: ["Hola", "que tal"] });
  assert.deepEqual(bubbleText("Solo una línea", true), { title: null, paragraphs: ["Solo una línea"] });
  assert.equal(bubbleText("x".repeat(100) + "\nresto", true).title, null);
  assert.deepEqual(bubbleText("", true), { title: null, paragraphs: [] });
});

test("los checks solo salen en mensajes propios", () => {
  assert.equal(readState({ fromFan: false, seen: true }), "leido");
  assert.equal(readState({ fromFan: false, seen: false }), "enviado");
  assert.equal(readState({ fromFan: false, seen: null }), null);
  assert.equal(readState({ fromFan: true, seen: true }), null);
});
