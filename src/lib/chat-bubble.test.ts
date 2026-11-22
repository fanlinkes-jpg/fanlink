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
