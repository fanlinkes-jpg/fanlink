import assert from "node:assert/strict";
import { test } from "node:test";
import { composerDraft, prepareOutbound, validOutboundPrice } from "../sync/composer-draft.ts";

test("el medio no entra en el texto, ni el título interno", () => {
  const draft = composerDraft("hola", [{ id: "v1", title: "SECRETO INTERNO" }]);
  assert.equal(draft.body, "hola");
  assert.deepEqual(draft.mediaIds, ["v1"]);
  const blocked = prepareOutbound("hola", [{ id: "v1", title: "SECRETO INTERNO" }], "NO VENDER");
  assert.equal(blocked.ok, false);
  if (!blocked.ok) assert.equal(blocked.notice, "NO VENDER");
  const mark = prepareOutbound("hola\n[adjunto] nota", [{ id: "v1", title: "SECRETO INTERNO" }], null);
  assert.equal(mark.ok, false);
  if (!mark.ok) assert.equal(mark.notice, "Quita la marca [adjunto] del mensaje");
  const leaked = prepareOutbound("mira SECRETO INTERNO esta noche", [
    { id: "v1", title: "SECRETO INTERNO", couple: "SOLA", act: "anal" },
  ], null);
  assert.equal(leaked.ok, false);
  if (!leaked.ok) assert.equal(leaked.notice, "Quita «SECRETO INTERNO» del mensaje");
  const tarde = prepareOutbound("esta tarde", [{ id: "v1", title: "tarde" }], null);
  assert.equal(tarde.ok, false);
  if (!tarde.ok) assert.equal(tarde.notice, "Quita «tarde» del mensaje");
  const accent = prepareOutbound("el sécreto de anoche", [{ id: "v1", title: "secreto" }], null);
  assert.equal(accent.ok, false);
  if (!accent.ok) assert.equal(accent.notice, "Quita «secreto» del mensaje");
  const letters = prepareOutbound("hola αβγ hoy", [{ id: "v1", title: "αβγ" }], null);
  assert.equal(letters.ok, false);
  if (!letters.ok) assert.equal(letters.notice, "Quita «αβγ» del mensaje");
  const couple = prepareOutbound("estoy sola esta noche", [
    { id: "v1", title: "clip", couple: "SOLA", act: "anal" },
  ], null);
  assert.equal(couple.ok, true);
  if (couple.ok) assert.equal(couple.body, "estoy sola esta noche");
  const inside = prepareOutbound("mira el canal", [{ id: "v1", title: "clip", act: "anal" }], null);
  assert.equal(inside.ok, true);
  if (inside.ok) assert.equal(inside.body, "mira el canal");
  const letter = prepareOutbound("a las nueve", [{ id: "v1", title: "a" }], null);
  assert.equal(letter.ok, true);
  if (letter.ok) assert.equal(letter.body, "a las nueve");
  const number = prepareOutbound("son 12 fotos", [{ id: "v1", title: "12" }], null);
  assert.equal(number.ok, true);
  const act = prepareOutbound("quiero anal", [{ id: "v1", title: "clip", act: "anal" }], null);
  assert.equal(act.ok, false);
  if (!act.ok) assert.equal(act.notice, "Quita «anal» del mensaje");
});

test("el precio del servidor acepta 200 USD y rechaza el resto", () => {
  const top = validOutboundPrice(20000);
  assert.equal(top.ok, true);
  if (top.ok) assert.equal(top.cents, 20000);
  assert.equal(validOutboundPrice(20001).ok, false);
  assert.equal(validOutboundPrice(299).ok, false);
  assert.equal(validOutboundPrice(-1).ok, false);
  assert.equal(validOutboundPrice(3.5).ok, false);
});
