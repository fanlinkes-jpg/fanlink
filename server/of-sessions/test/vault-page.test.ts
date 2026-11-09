import assert from "node:assert/strict";
import test from "node:test";
import { chooseVaultPayloads, countVault } from "../sync/vault-listen.ts";
import { parseVaultBundle } from "../sync/vault-model.ts";

const lists = {
  list: [
    { id: 10, type: "custom", name: "Sets" },
    { id: 11, type: "custom", name: "Fotos" },
  ],
};

const media = {
  list: [
    {
      id: 9001,
      type: "photo",
      createdAt: "2026-04-03T16:16:36+00:00",
      files: { thumb: { url: "https://cdn2.onlyfans.com/files/a/thumb.jpg" }, full: { url: "https://cdn2.onlyfans.com/files/a/full.jpg" } },
      listStates: [{ id: 10, type: "custom", name: "Sets" }],
    },
    {
      id: 9002,
      type: "video",
      duration: 12,
      files: { thumb: { url: "https://cdn2.onlyfans.com/files/b/thumb.jpg" } },
    },
  ],
  hasMore: true,
};

test("el JSON de la bóveda de OnlyFans trae carpetas y medios", () => {
  const parsedLists = parseVaultBundle(lists);
  const parsedMedia = parseVaultBundle(media);
  assert.deepEqual(parsedLists.lists.map((list) => list.name), ["Sets", "Fotos"]);
  assert.equal(parsedLists.items.length, 0);
  assert.equal(parsedMedia.items.length, 2);
  assert.equal(parsedMedia.items[0]?.kind, "foto");
  assert.equal(parsedMedia.items[0]?.preview, "https://cdn2.onlyfans.com/files/a/thumb.jpg");
  assert.equal(parsedMedia.items[1]?.kind, "video");
  assert.equal(parsedMedia.items[1]?.seconds, 12);
});

test("si el fetch no trae medios, se usan los de la página", () => {
  const chosen = chooseVaultPayloads([], [lists, media]);
  assert.equal(countVault(chosen).files, 2);
  assert.equal(countVault(chosen).folders, 2);
});

test("un fetch vacío no cuenta como bóveda", () => {
  assert.deepEqual(chooseVaultPayloads([], []), []);
  assert.equal(countVault([{ ok: false }]).files, 0);
});
