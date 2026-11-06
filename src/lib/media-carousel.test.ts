import assert from "node:assert/strict";
import { test } from "node:test";
import { nextMediaIndex } from "./media-carousel.ts";

test("el carrusel da la vuelta", () => {
  assert.equal(nextMediaIndex(0, 3, -1), 2);
  assert.equal(nextMediaIndex(2, 3, 1), 0);
  assert.equal(nextMediaIndex(0, 0, 1), 0);
});
