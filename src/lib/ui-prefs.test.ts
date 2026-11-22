import assert from "node:assert/strict";
import test from "node:test";
import { mediaBlurred, readComposerLanguage, readSfw, writeComposerLanguage, writeSfw } from "./ui-prefs.ts";

function memory() {
  const box = new Map<string, string>();
  return {
    getItem: (key: string) => box.get(key) ?? null,
    setItem: (key: string, value: string) => {
      box.set(key, value);
    },
  };
}

test("SFW difumina y se destapa al revelar", () => {
  assert.equal(mediaBlurred(true, false), true);
  assert.equal(mediaBlurred(true, true), false);
  assert.equal(mediaBlurred(false, false), false);
  assert.equal(mediaBlurred(false, true), false);
});

test("el idioma de arriba y el del compositor es el mismo, y SFW es por usuario", () => {
  const storage = memory();
  writeComposerLanguage(storage, "dev-user", "en");
  const header = readComposerLanguage(storage, "dev-user");
  const composer = readComposerLanguage(storage, "dev-user");
  assert.equal(header, "en");
  assert.equal(composer, header);
  assert.equal(readComposerLanguage(storage, "otra"), "es");
  writeSfw(storage, "dev-user", true);
  assert.equal(readSfw(storage, "dev-user"), true);
  assert.equal(readSfw(storage, "otra"), false);
  writeSfw(storage, "dev-user", false);
  assert.equal(readSfw(storage, "dev-user"), false);
});
