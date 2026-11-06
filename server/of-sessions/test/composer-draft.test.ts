import assert from "node:assert/strict";
import { test } from "node:test";
import { composerDraft, prepareOutbound, validOutboundPrice } from "../sync/composer-draft.ts";

test("el medio no entra en el texto, ni el título interno", () => {
  const draft = composerDraft("hola\n[adjunto] nota", [{ id: "v1", title: "SECRETO INTERNO" }]);
  assert.equal(draft.body, "hola");
  assert.deepEqual(draft.mediaIds, ["v1"]);
  const blocked = prepareOutbound("hola", [{ id: "v1", title: "SECRETO INTERNO" }], "NO VENDER");
  assert.equal(blocked.ok, false);
  if (!blocked.ok) assert.equal(blocked.notice, "NO VENDER");
  const leaked = prepareOutbound("mira SECRETO INTERNO esta noche", [
    { id: "v1", title: "SECRETO INTERNO", couple: "SOLA", act: "anal" },
  ], null);
  assert.equal(leaked.ok, false);
  if (!leaked.ok) assert.equal(leaked.notice, "Quita el título del mensaje");
  const accent = prepareOutbound("el sécreto de anoche", [{ id: "v1", title: "secreto" }], null);
  assert.equal(accent.ok, false);
  const couple = prepareOutbound("estoy sola esta noche", [
    { id: "v1", title: "tarde", couple: "SOLA", act: "anal" },
  ], null);
  assert.equal(couple.ok, true);
  if (couple.ok) assert.equal(couple.body, "estoy sola esta noche");
  const inside = prepareOutbound("mira el canal", [{ id: "v1", title: "tarde", act: "anal" }], null);
  assert.equal(inside.ok, true);
  if (inside.ok) assert.equal(inside.body, "mira el canal");
  const letter = prepareOutbound("a las nueve", [{ id: "v1", title: "a" }], null);
  assert.equal(letter.ok, true);
  if (letter.ok) assert.equal(letter.body, "a las nueve");
  const number = prepareOutbound("son 12 fotos", [{ id: "v1", title: "12" }], null);
  assert.equal(number.ok, true);
  const act = prepareOutbound("quiero anal", [{ id: "v1", title: "tarde", act: "anal" }], null);
  assert.equal(act.ok, false);
  if (!act.ok) assert.equal(act.notice, "Quita el acto del mensaje");
  const free = validOutboundPrice(null);
  const zero = validOutboundPrice(0);
  const ppv = validOutboundPrice(300);
  const top = validOutboundPrice(20_000);
  assert.equal(free.ok && free.cents, null);
  assert.equal(zero.ok && zero.cents, null);
  assert.equal(ppv.ok && ppv.cents, 300);
  assert.equal(top.ok && top.cents, 20_000);
  assert.equal(validOutboundPrice(299).ok, false);
  assert.equal(validOutboundPrice(20_001).ok, false);
  assert.equal(validOutboundPrice(1.5).ok, false);
});
