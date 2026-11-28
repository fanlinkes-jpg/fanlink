import assert from "node:assert/strict";
import { test } from "node:test";
import { INTENT_MS, STICK_PX, stickAfterScroll, userRecently } from "./stick-bottom.ts";

test("abajo del todo siempre se queda pegado", () => {
  assert.equal(stickAfterScroll({ distance: 0, userRecently: false, wasStuck: false }), true);
  assert.equal(stickAfterScroll({ distance: STICK_PX - 1, userRecently: true, wasStuck: false }), true);
});

test("lejos del final solo lo suelta la persona", () => {
  assert.equal(stickAfterScroll({ distance: 600, userRecently: true, wasStuck: true }), false);
  // El navegador movió el scroll (la lista se encoge, crece un medio): no suelta el final.
  assert.equal(stickAfterScroll({ distance: 600, userRecently: false, wasStuck: true }), true);
  // Si ya estaba suelto, sigue suelto hasta que vuelva abajo.
  assert.equal(stickAfterScroll({ distance: 600, userRecently: false, wasStuck: false }), false);
});

test("la intención de la persona dura poco", () => {
  assert.equal(userRecently(1000, 1000 + INTENT_MS - 1), true);
  assert.equal(userRecently(1000, 1000 + INTENT_MS), false);
  assert.equal(userRecently(0, 5000), false);
});
