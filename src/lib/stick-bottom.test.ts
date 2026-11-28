import assert from "node:assert/strict";
import { test } from "node:test";
import { INTENT_MS, STICK_PX, anchorShift, keyScrollsUp, stickAfterScroll, userRecently, type ScrollSample } from "./stick-bottom.ts";

const at = (top: number, height = 5000, client = 400): ScrollSample => ({ top, height, client });
const bottom = at(4600);

test("subir un solo píxel suelta el final, haya visto o no el gesto", () => {
  assert.equal(stickAfterScroll({ now: at(4599), prev: bottom, wasStuck: true, userActive: true }), false);
  assert.equal(stickAfterScroll({ now: at(4599), prev: bottom, wasStuck: true, userActive: false }), false);
});

test("soltado el final, un scroll sin acción de la persona no la devuelve abajo", () => {
  assert.equal(stickAfterScroll({ now: at(4590), prev: at(4590), wasStuck: false, userActive: false }), false);
  assert.equal(stickAfterScroll({ now: at(4595), prev: at(4590), wasStuck: false, userActive: false }), false);
});

test("solo vuelve a pegarse si la persona baja hasta menos de 30 px del final", () => {
  assert.equal(STICK_PX, 30);
  // Baja y queda a 40 px: todavía no.
  assert.equal(stickAfterScroll({ now: at(4560), prev: at(4300), wasStuck: false, userActive: true }), false);
  // Baja y queda a 20 px: se pega.
  assert.equal(stickAfterScroll({ now: at(4580), prev: at(4560), wasStuck: false, userActive: true }), true);
});

test("un scroll del navegador no suelta el final: la lista encoge, crece o se recorta el contenido", () => {
  // El contenido se acorta y el navegador recorta el scroll.
  assert.equal(stickAfterScroll({ now: at(3900, 4300), prev: bottom, wasStuck: true, userActive: false }), true);
  // La lista crece (desaparece un aviso) y el navegador recorta el scroll.
  assert.equal(stickAfterScroll({ now: { top: 4460, height: 5000, client: 540 }, prev: bottom, wasStuck: true, userActive: false }), true);
  // Un medio crece y el final queda lejos sin que se mueva el scroll.
  assert.equal(stickAfterScroll({ now: at(4600, 5400), prev: bottom, wasStuck: true, userActive: false }), true);
});

test("la intención de la persona dura poco", () => {
  assert.equal(userRecently(1000, 1000 + INTENT_MS - 1), true);
  assert.equal(userRecently(1000, 1000 + INTENT_MS), false);
});

test("las teclas de subir cuentan; el resto del teclado no", () => {
  for (const key of ["ArrowUp", "PageUp", "Home"]) assert.equal(keyScrollsUp({ key }), true);
  assert.equal(keyScrollsUp({ key: " ", shiftKey: true }), true);
  for (const key of ["ArrowDown", "PageDown", "End", "a", " "]) assert.equal(keyScrollsUp({ key }), false);
});

test("al entrar historial por arriba el mensaje que se lee se mueve lo mismo que el contenido nuevo", () => {
  assert.equal(anchorShift({ offset: 120 }, 120), 0);
  assert.equal(anchorShift({ offset: 120 }, 2520), 2400);
  assert.equal(anchorShift(null, 300), 0);
  assert.equal(anchorShift({ offset: 10 }, null), 0);
  assert.equal(anchorShift({ offset: 10 }, 10.3), 0);
});
