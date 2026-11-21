import assert from "node:assert/strict";
import test from "node:test";
import { folderGridItems, mergeVaultPage, sameVaultId, vaultLoadAllowed } from "./vault-load.ts";

test("una carpeta entra aunque Todos siga ocupado", () => {
  const busyAll = { busy: true, listId: "all" };
  assert.equal(vaultLoadAllowed(busyAll, { listId: "nocturno", offset: 0 }), true);
  assert.equal(vaultLoadAllowed(busyAll, { listId: "all", offset: 40 }), false);
  assert.equal(vaultLoadAllowed({ busy: false, listId: "all" }, { listId: "all", offset: 40 }), true);
  assert.equal(vaultLoadAllowed({ busy: true, listId: "nocturno" }, { listId: "nocturno", offset: 40 }), false);
  assert.equal(vaultLoadAllowed(busyAll, { listId: "nocturno", offset: -1 }), false);
});

test("la página siguiente de una carpeta se añade sin repetir", () => {
  const page = mergeVaultPage([{ id: "a" }, { id: "b" }], [{ id: "b" }, { id: "c" }]);
  assert.deepEqual(page.map((item) => item.id), ["a", "b", "c"]);
});

test("un id numérico de la lista casa con el string de la UI y no hereda Todos", () => {
  assert.equal(sameVaultId(28619188, "28619188"), true);
  const mirror = [
    { id: "todos-1", listId: null },
    { id: "todos-2", listId: null },
    { id: "todos-3", listId: null },
    { id: "todos-4", listId: null },
    { id: "ducha", listId: "29012649" },
  ];
  const page = [{ id: "clip", listId: "29012649" }];
  assert.deepEqual(folderGridItems(mirror, page, 29012649, "29012649").map((item) => item.id), ["clip"]);
  assert.deepEqual(folderGridItems(mirror, [], "29012649", "all").map((item) => item.id), ["ducha"]);
  assert.deepEqual(folderGridItems(mirror, [], 28619188, "28619188"), []);
});
