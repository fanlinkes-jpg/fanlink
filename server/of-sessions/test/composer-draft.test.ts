import assert from "node:assert/strict";
import { test } from "node:test";
import { composerDraft, prepareOutbound } from "../sync/composer-draft.ts";

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
});
