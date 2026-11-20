import assert from "node:assert/strict";
import { test } from "node:test";
import { containedCanvasPoint } from "./live-pointer.ts";

test("el clic ignora las bandas de object-contain y cae en el bitmap", () => {
  const origin = containedCanvasPoint(180, 0, { width: 1000, height: 400 }, { width: 1440, height: 900 });
  assert.equal(origin.canvasWidth, 1440);
  assert.equal(origin.canvasHeight, 900);
  assert.ok(Math.abs(origin.x) < 0.01);
  assert.ok(Math.abs(origin.y) < 0.01);
  const center = containedCanvasPoint(500, 200, { width: 1000, height: 400 }, { width: 1440, height: 900 });
  assert.ok(Math.abs(center.x - 720) < 0.01);
  assert.ok(Math.abs(center.y - 450) < 0.01);
});
