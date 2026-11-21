import assert from "node:assert/strict";
import test from "node:test";
import { vaultFolderLabel } from "./vault-folder-label.ts";

const none = { photos: 0, videos: 0, gifs: 0 };

test("una lista con contadores no sale vacía aunque aún no se hayan pintado sus medios", () => {
  assert.equal(
    vaultFolderLabel({ photos: 12, videos: 4, gifs: 0, audios: 0, hasMedia: true }, none),
    "12 fotos · 4 vídeos",
  );
  assert.equal(
    vaultFolderLabel({ photos: null, videos: null, gifs: null, audios: null, hasMedia: null }, { photos: 2, videos: 1, gifs: 0 }),
    "2 fotos · 1 vídeo",
  );
});

test("un 0 de la carpeta no se sustituye por los medios de Todos", () => {
  assert.equal(
    vaultFolderLabel({ photos: 0, videos: 2, gifs: 0, audios: 0, hasMedia: true }, { photos: 615, videos: 2, gifs: 2 }),
    "0 fotos · 2 vídeos",
  );
});

test("vacío solo cuando OnlyFans dice que la lista no tiene medios", () => {
  assert.equal(
    vaultFolderLabel({ photos: 0, videos: 0, gifs: 0, audios: 0, hasMedia: false }, none),
    "vacío",
  );
  assert.equal(
    vaultFolderLabel({ photos: null, videos: null, gifs: null, audios: null, hasMedia: null }, none),
    "Sin datos",
  );
  assert.equal(
    vaultFolderLabel({ photos: null, videos: null, gifs: null, audios: null, hasMedia: null, count: 9 }, none),
    "9 medios",
  );
});
