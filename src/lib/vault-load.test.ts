import assert from "node:assert/strict";
import test from "node:test";
import { folderGridCap, folderGridItems, ignoreStaleVaultView, mergeVaultPage, nextVaultLibrary, sameVaultId, vaultFolderOnAccountChange, vaultLoadAllowed, vaultQueryFolderOnCreatorChange, vaultReadApplies } from "./vault-load.ts";

test("una carpeta entra aunque Todos siga ocupado", () => {
  const busyAll = { busy: true, listId: "all" };
  assert.equal(vaultLoadAllowed(busyAll, { listId: "nocturno", offset: 0 }), true);
  assert.equal(vaultLoadAllowed(busyAll, { listId: "all", offset: 40 }), false);
  assert.equal(vaultLoadAllowed({ busy: false, listId: "all" }, { listId: "all", offset: 40 }), true);
  assert.equal(vaultLoadAllowed({ busy: true, listId: "nocturno" }, { listId: "nocturno", offset: 40 }), false);
  assert.equal(vaultLoadAllowed(busyAll, { listId: "nocturno", offset: -1 }), false);
});

test("al cambiar de cuenta la carpeta no se arrastra", () => {
  const left = vaultFolderOnAccountChange({}, "jose", "allison", "30436423");
  assert.equal(left.listId, "all");
  assert.equal(left.memory.jose, "30436423");
  const back = vaultFolderOnAccountChange(left.memory, "allison", "jose", "all");
  assert.equal(back.listId, "30436423");
  assert.equal(back.memory.allison, "all");
  assert.equal(vaultFolderOnAccountChange(back.memory, "jose", "jose", "30436423").listId, "30436423");
});

test("la respuesta tardía de A no se pinta después de cambiar a B", () => {
  const late = { id: "medio-de-jose", title: "Mensajes" };
  assert.equal(vaultReadApplies({
    generation: 1,
    currentGeneration: 2,
    requestCreatorId: "jose",
    activeCreatorId: "allison",
  }), false);
  assert.equal(vaultReadApplies({
    generation: 2,
    currentGeneration: 2,
    requestCreatorId: "jose",
    activeCreatorId: "allison",
  }), false);
  assert.equal(vaultReadApplies({
    generation: 2,
    currentGeneration: 2,
    requestCreatorId: "allison",
    activeCreatorId: "allison",
  }), true);
  assert.equal(late.id === "medio-de-jose" && vaultReadApplies({
    generation: 1,
    currentGeneration: 2,
    requestCreatorId: "jose",
    activeCreatorId: "allison",
  }), false);
});

test("la página de bóveda suelta la carpeta al cambiar de creadora", () => {
  assert.equal(vaultQueryFolderOnCreatorChange("jose", "allison", "mensajes"), null);
  assert.equal(vaultQueryFolderOnCreatorChange("allison", "allison", "mensajes"), "mensajes");
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
  const cap = folderGridCap({ photos: 0, videos: 2, gifs: 0, audios: 0 });
  assert.equal(cap, 6);
  const swollen = Array.from({ length: 40 }, (_, index) => ({ id: `todo-${index}`, listId: "2901" as string | null, listIds: [] as string[] }));
  const own = [{ id: "clip-a", listId: null as string | null, listIds: ["2901"] }, { id: "clip-b", listId: null as string | null, listIds: ["2901"] }];
  assert.deepEqual(folderGridItems(own, swollen, "2901", "2901", cap).map((item) => item.id), ["clip-a", "clip-b"]);
  assert.deepEqual(folderGridItems(swollen, [], "2901", "2901", cap), []);
  assert.deepEqual(folderGridItems(own, [{ id: "clip-a", listId: "2901", listIds: [] }], "2901", "2901", cap).map((item) => item.id), ["clip-a"]);
  assert.equal(ignoreStaleVaultView("2901", null), true);
  assert.equal(ignoreStaleVaultView("2901", "2901"), false);
  assert.deepEqual(nextVaultLibrary("2901", [{ id: "todos" }], [{ id: "clip-a" }]), [{ id: "todos" }]);
  assert.deepEqual(nextVaultLibrary(null, [], [{ id: "todos" }]), [{ id: "todos" }]);
});
