import assert from "node:assert/strict";
import test from "node:test";
import { initialOf } from "./initial.ts";

test("la inicial nunca corta un emoji ni deja un surrogate suelto", () => {
  assert.equal(initialOf("Ana"), "A");
  assert.equal(initialOf("  marta"), "M");
  assert.equal(initialOf("😀 Ana"), "A");
  assert.equal(initialOf("👩‍❤️‍👨 Mar"), "M");
  assert.equal(initialOf("😀"), "😀");
  assert.equal(initialOf("👩‍❤️‍👨"), "👩‍❤️‍👨");
  assert.equal(initialOf("𝓜aría"), "𝓜".toLocaleUpperCase("es"));
  assert.equal(initialOf("ñandú"), "Ñ");
  assert.equal(initialOf("7up"), "7");
  assert.equal(initialOf(""), "?");
  assert.equal(initialOf(null), "?");
  for (const name of ["😀 Ana", "😀", "👨‍👩‍👧 Fam", "𝓜aría", "🇪🇸 Spain"]) {
    assert.doesNotMatch(initialOf(name), /\uFFFD/);
    assert.equal(initialOf(name), initialOf(name).normalize("NFC"));
    assert.equal(new TextDecoder("utf-8", { fatal: true }).decode(new TextEncoder().encode(initialOf(name))), initialOf(name));
  }
});
