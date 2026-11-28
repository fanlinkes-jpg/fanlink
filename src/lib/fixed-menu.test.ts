import assert from "node:assert/strict";
import { test } from "node:test";
import { menuPlacement } from "./fixed-menu.ts";

test("el menú baja si cabe y sube si no hay sitio debajo", () => {
  const menu = { width: 224, height: 140 };
  const viewport = { width: 1280, height: 800 };
  const down = menuPlacement({ top: 100, bottom: 132, left: 900, right: 1100 }, menu, viewport);
  assert.equal(down.openUp, false);
  assert.equal(down.top, 136);
  assert.equal(down.left, 1100 - 224);

  const up = menuPlacement({ top: 720, bottom: 752, left: 900, right: 1100 }, menu, viewport);
  assert.equal(up.openUp, true);
  assert.equal(up.top, 720 - 140 - 4);
  assert.equal(up.left, 1100 - 224);
});

test("el menú no se sale del viewport", () => {
  const placed = menuPlacement(
    { top: 10, bottom: 40, left: 20, right: 80 },
    { width: 224, height: 140 },
    { width: 300, height: 160 },
  );
  assert.equal(placed.left, 8);
  assert.ok(placed.top >= 8);
  assert.ok(placed.top + 140 <= 160 - 8 || placed.top === 8);
});
