import assert from "node:assert/strict";
import { test } from "node:test";
import { composerDraft, prepareOutbound, validOutboundPrice } from "../sync/composer-draft.ts";

test("el medio no entra en el texto, ni el título interno", () => {
  const draft = composerDraft("hola\n[adjunto] SECRETO INTERNO\nSECRETO INTERNO", [
    { id: "v1", title: "SECRETO INTERNO" },
  ]);
  assert.equal(draft.body, "hola");
  assert.deepEqual(draft.mediaIds, ["v1"]);
  assert.equal(draft.body.includes("SECRETO"), false);
  assert.equal(draft.body.includes("[adjunto]"), false);
  const blocked = prepareOutbound("hola", [{ id: "v1", title: "SECRETO INTERNO" }], "NO VENDER");
  assert.equal(blocked.ok, false);
  if (!blocked.ok) assert.equal(blocked.notice, "NO VENDER");
  const pasted = composerDraft("mira SECRETO INTERNO con SOLA y anal", [
    { id: "v1", title: "SECRETO INTERNO", couple: "SOLA", act: "anal" },
  ]);
  assert.equal(pasted.body, "mira con y");
  assert.equal(pasted.body.includes("SECRETO"), false);
  assert.equal(pasted.body.includes("SOLA"), false);
  assert.equal(pasted.body.includes("anal"), false);
  const free = validOutboundPrice(null);
  const zero = validOutboundPrice(0);
  const ppv = validOutboundPrice(300);
  assert.equal(free.ok && free.cents, null);
  assert.equal(zero.ok && zero.cents, null);
  assert.equal(ppv.ok && ppv.cents, 300);
  assert.equal(validOutboundPrice(299).ok, false);
  assert.equal(validOutboundPrice(1.5).ok, false);
});
