import assert from "node:assert/strict";
import { test } from "node:test";
import { markReadOnOpen } from "./mark-read-open.ts";

test("marcar leído solo sale de un clic y no de un hilo que ya está en 0", () => {
  assert.equal(markReadOnOpen("click", 4), true);
  assert.equal(markReadOnOpen("click", null), true);
  assert.equal(markReadOnOpen("click", 0), false);
  assert.equal(markReadOnOpen("render", 4), false);
  assert.equal(markReadOnOpen("hover", 4), false);
  assert.equal(markReadOnOpen("poll", 4), false);
});
