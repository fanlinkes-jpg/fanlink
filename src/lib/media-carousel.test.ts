import assert from "node:assert/strict";
import { test } from "node:test";
import { nextMediaIndex } from "./media-carousel.ts";

test("el carrusel da la vuelta entre las dos medias", () => {
  assert.equal(nextMediaIndex(0, 2, 1), 1);
  assert.equal(nextMediaIndex(1, 2, 1), 0);
  assert.equal(nextMediaIndex(0, 2, -1), 1);
  assert.equal(nextMediaIndex(0, 0, 1), 0);
});
