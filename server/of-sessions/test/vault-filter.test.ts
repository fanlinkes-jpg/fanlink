import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { emptyVaultQuery, filterVault, rememberVaultQuery, restoredVaultQuery, searchVaultLists, searchVaultMedia, vaultQueryFor, type VaultFolder, type VaultQuery } from "../sync/vault-filter.ts";
import { historyFromMedia, mergeFanUses, suggestVaultPrice, trailerPackages, vaultSaleBlocked, type VaultFile } from "../sync/vault-model.ts";
import { loadVaultQuery, saveVaultQuery } from "../sync/vault-store.ts";
import type { ReadSql } from "../sync/store.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function item(patch: Partial<VaultFile> & Pick<VaultFile, "id">): VaultFile {
  return {
    title: patch.id,
    kind: "video",
    seconds: 120,
    preview: null,
    folder: null,
    tags: [],
    listId: null,
    listName: null,
    description: null,
    uploadedAt: "2026-11-01T00:00:00.000Z",
    priceCents: 1500,
    salesCount: 0,
    sentCount: 0,
    ...patch,
  };
}

test("el texto busca lista, carpeta, descripción y etiqueta, y los filtros se suman", () => {
  const items = [
    item({ id: "bg", folder: "B/G", listName: "Parejas", description: "playa", tags: ["Feed"], seconds: 90, uploadedAt: "2026-10-02", priceCents: 1900, kind: "video" }),
    item({ id: "sola", folder: "SOLA", description: "estudio", tags: ["Sent"], seconds: 30, uploadedAt: "2026-11-02", priceCents: 0, kind: "foto" }),
    item({ id: "audio", folder: "INDIVIDUAL", description: "voz", tags: ["noche"], seconds: 400, uploadedAt: "2026-09-01", priceCents: 500, kind: "audio" }),
    item({ id: "peli", folder: "PELICULA", listName: "Largas", description: "anal largo", tags: [], seconds: 700, uploadedAt: "2026-08-01", priceCents: 2900, kind: "video", salesCount: 8, sentCount: 10 }),
  ];
  assert.deepEqual(filterVault(items, { ...emptyVaultQuery(), text: "parejas" }).map((row) => row.id), ["bg"]);
  assert.deepEqual(filterVault(items, { ...emptyVaultQuery(), text: "estudio" }).map((row) => row.id), ["sola"]);
  assert.deepEqual(filterVault(items, { ...emptyVaultQuery(), text: "noche" }).map((row) => row.id), ["audio"]);
  assert.deepEqual(filterVault(items, { ...emptyVaultQuery(), themes: ["noche"] }).map((row) => row.id), ["audio"]);
  const combined = filterVault(items, {
    ...emptyVaultQuery(),
    kinds: ["video"],
    minSeconds: 60,
    maxSeconds: 120,
    uploadedFrom: "2026-10-01",
    uploadedTo: "2026-10-31",
    list: "parejas",
    couples: ["B/G"],
    offer: "ppv",
    minPriceCents: 1900,
    maxPriceCents: 1900,
  });
  assert.deepEqual(combined.map((row) => row.id), ["bg"]);
  assert.deepEqual(filterVault(items, { ...emptyVaultQuery(), couples: ["G/G"] }).map((row) => row.id), []);
  assert.deepEqual(filterVault(items, { ...emptyVaultQuery(), offer: "gratis" }).map((row) => row.id), ["sola"]);
});

test("enviado, comprado, más vendido y buy rate se combinan con el orden", () => {
  const items = [
    item({ id: "nuevo", salesCount: 1, sentCount: 10, priceCents: 1200, seconds: 60, uploadedAt: "2026-11-03" }),
    item({ id: "top", salesCount: 9, sentCount: 10, priceCents: 2500, seconds: 400, uploadedAt: "2026-01-01" }),
    item({ id: "medio", salesCount: 4, sentCount: 10, priceCents: 800, seconds: 180, uploadedAt: "2026-06-01" }),
  ];
  const fan = { sentIds: new Set(["top", "nuevo"]), boughtIds: new Set(["top"]) };
  const query: VaultQuery = {
    ...emptyVaultQuery(),
    sent: "si",
    bought: "no",
    bestSeller: false,
    minBuyRate: null,
    sort: "ventas",
  };
  assert.deepEqual(filterVault(items, query, fan).map((row) => row.id), ["nuevo"]);
  const sellers = filterVault(items, { ...emptyVaultQuery(), bestSeller: true, sort: "ventas" });
  assert.deepEqual(sellers.map((row) => row.id), ["top"]);
  assert.deepEqual(filterVault(items, { ...emptyVaultQuery(), minBuyRate: 0.8 }).map((row) => row.id), ["top"]);
  assert.deepEqual(filterVault(items, { ...emptyVaultQuery(), sort: "duracion" }).map((row) => row.id), ["top", "medio", "nuevo"]);
  assert.deepEqual(filterVault(items, { ...emptyVaultQuery(), sort: "precio" }).map((row) => row.id), ["top", "nuevo", "medio"]);
  assert.deepEqual(filterVault(items, { ...emptyVaultQuery(), sort: "fecha" }).map((row) => row.id), ["nuevo", "medio", "top"]);
});

test("cada chatter recuerda su filtro y no el de otro", async () => {
  const ana = { ...emptyVaultQuery(), text: "sola", kinds: ["video" as const], sort: "duracion" as const };
  const luis = { ...emptyVaultQuery(), offer: "ppv" as const, bestSeller: true };
  const book = rememberVaultQuery(rememberVaultQuery({}, "ana", ana), "luis", luis);
  assert.equal(vaultQueryFor(book, "ana").text, "sola");
  assert.equal(vaultQueryFor(book, "luis").bestSeller, true);
  assert.equal(vaultQueryFor(book, "otra").text, "");
  assert.equal(restoredVaultQuery(ana).text, "sola");
  const db = new PGlite();
  await db.exec(await readFile(path.join(root, "migrations", "0038_vault_fan_filter.sql"), "utf8"));
  const sql: ReadSql = {
    async query<T>(text: string, params?: unknown[]): Promise<T[]> {
      const result = await db.query<T>(text, params);
      return result.rows;
    },
  };
  await saveVaultQuery(sql, "ana", ana);
  await saveVaultQuery(sql, "luis", luis);
  assert.equal((await loadVaultQuery(sql, "ana")).text, "sola");
  assert.deepEqual((await loadVaultQuery(sql, "ana")).kinds, ["video"]);
  assert.equal((await loadVaultQuery(sql, "luis")).bestSeller, true);
  assert.equal((await loadVaultQuery(sql, "nadie")).sort, "fecha");
  await db.close();
});

test("no vender bloquea, el precio sugerido no se inventa y el historial no duplica", () => {
  assert.equal(vaultSaleBlocked("NO VENDER", "clip"), true);
  assert.equal(vaultSaleBlocked("SOLA", "sin editar"), true);
  assert.equal(vaultSaleBlocked("SOLA", "playa"), false);
  assert.equal(suggestVaultPrice({ seconds: 60, folder: "SOLA", title: "playa" }).label, "Sin datos");
  assert.equal(suggestVaultPrice({ seconds: 60, folder: "SOLA", title: "playa", purchasesCents: [1900, 2500] }).cents, 1900);
  const uses = mergeFanUses([
    ...historyFromMedia([{
      fanKey: "7",
      fromFan: false,
      sentAt: "2026-11-01T00:00:00.000Z",
      priceCents: 1500,
      purchased: true,
      authorId: "ana",
      mediaJson: JSON.stringify([{ id: "m1" }]),
    }]),
    {
      itemKey: "m1",
      fanKey: "7",
      sentAt: "2026-11-02T00:00:00.000Z",
      priceCents: null,
      purchased: null,
      authorId: null,
    },
  ]);
  assert.equal(uses.length, 1);
  assert.equal(uses[0]?.priceCents, 1500);
  assert.equal(uses[0]?.purchased, true);
  assert.equal(uses[0]?.sentAt, "2026-11-02T00:00:00.000Z");
  const packs = trailerPackages([
    item({ id: "t", title: "Tráiler gratis", priceCents: 0, tags: ["Tráiler"], listId: "set", folder: "set" }),
    item({ id: "p", title: "de pago", priceCents: 2500, listId: "set", folder: "set" }),
  ]);
  assert.equal(packs.length, 1);
  assert.equal(packs[0]?.trailerId, "t");
});

test("el buscador encuentra por etiqueta o por carpeta, dentro de la abierta o en todas", () => {
  const folders: VaultFolder[] = [
    { id: "sets", name: "Sets", parentId: null },
    { id: "bg", name: "B/G", parentId: "sets" },
    { id: "sola", name: "SOLA", parentId: null },
  ];
  const items = [
    item({ id: "pareja", listId: "bg", listName: "B/G", folder: "B/G", tags: ["Feed"], title: "clip" }),
    item({ id: "estudio", listId: "sola", listName: "SOLA", folder: "SOLA", tags: ["noche"], title: "toma" }),
  ];
  assert.deepEqual(searchVaultMedia(items, folders, { text: "noche", scope: "todas", folderId: null }).map((row) => row.id), ["estudio"]);
  assert.deepEqual(searchVaultMedia(items, folders, { text: "b/g", scope: "todas", folderId: null }).map((row) => row.id), ["pareja"]);
  assert.deepEqual(searchVaultMedia(items, folders, { text: "noche", scope: "carpeta", folderId: "bg" }).map((row) => row.id), []);
  assert.deepEqual(searchVaultMedia(items, folders, { text: "", scope: "carpeta", folderId: "sets" }).map((row) => row.id), ["pareja"]);
  assert.deepEqual(searchVaultLists(folders, "sola").map((folder) => folder.id), ["sola"]);
  assert.deepEqual(searchVaultLists(folders, "b/g").map((folder) => folder.id), ["sets", "bg"]);
});
