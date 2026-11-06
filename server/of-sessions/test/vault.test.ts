import assert from "node:assert/strict";
import { test } from "node:test";
import { mediaItems } from "../sync/chats.ts";
import {
  EMPTY_FILTERS,
  applyVaultFilters,
  attachVaultItem,
  captureVault,
  continueVault,
  decodeFilters,
  encodeFilters,
  filterStorageKey,
  folderTree,
  parseVaultPayload,
  plannedVaultNavigation,
  sendToFan,
  sendsFromMessages,
  inheritedBlock,
  PRICE_RULE_LABEL,
  priceRuleFromEnv,
  sendBlock,
  suggestPriceCents,
  vaultForRole,
  vaultForBrowser,
  vaultPaceMs,
  type VaultItem,
  type VaultPageLike,
} from "../sync/vault.ts";

const sola: VaultItem = {
  id: "v1",
  title: "tarde",
  kind: "video",
  seconds: 180,
  preview: "https://cdn2.onlyfans.com/t.jpg",
  full: "https://cdn2.onlyfans.com/full.mp4",
  createdAt: "2026-11-01T10:00:00.000Z",
  folderId: "sola",
  tags: ["feed"],
  priceCents: null,
  sales: 2,
  trailer: false,
  couple: "SOLA",
  act: null,
  blocked: null,
};

test("el id del medio del chat coincide con el de la bóveda", () => {
  const chat = mediaItems({ media: [{ id: 99, type: "video" }] });
  const vault = parseVaultPayload({ list: [{ id: 99, type: "video", name: "tarde" }] });
  assert.equal(chat[0]?.vaultId, "99");
  assert.equal(vault.items[0]?.id, chat[0]?.vaultId);
});

test("el listado sale del JSON de la página, con carpetas y etiquetas", () => {
  const read = parseVaultPayload({
    hasMore: true,
    nextOffset: "20",
    folders: [{ id: "sola", type: "folder", name: "SOLA", parentId: null }],
    list: [{
      id: 9,
      type: "video",
      name: "tarde",
      duration: 90,
      listId: "sola",
      createdAt: "2026-11-06T12:00:00.000Z",
      files: { thumb: { url: "https://cdn2.onlyfans.com/t.jpg" }, full: { url: "https://cdn2.onlyfans.com/v.mp4" } },
      listStates: [{ type: "sent" }, { type: "posts" }],
      isFree: true,
    }],
  });
  assert.equal(read.cursor, "20");
  assert.equal(read.done, false);
  assert.equal(read.folders[0]?.name, "SOLA");
  assert.equal(read.items[0]?.kind, "video");
  assert.equal(read.items[0]?.seconds, 90);
  assert.equal(read.items[0]?.couple, "SOLA");
  assert.deepEqual(read.items[0]?.tags, ["sent", "feed"]);
  assert.equal(read.items[0]?.trailer, true);
  assert.equal(read.items[0]?.full, "https://cdn2.onlyfans.com/v.mp4");
  assert.deepEqual(parseVaultPayload({ html: "<div>" }).items, []);
});

test("la navegación es la página del vault y el ritmo no baja de 5 s", () => {
  assert.deepEqual(plannedVaultNavigation("https://onlyfans.com"), ["https://onlyfans.com/my/vault"]);
  assert.equal(plannedVaultNavigation("https://onlyfans.com")[0]?.includes("api2"), false);
  assert.equal(vaultPaceMs(undefined), 5_000);
  assert.equal(vaultPaceMs("1000"), 5_000);
  assert.equal(vaultPaceMs("8000"), 8_000);
  assert.equal(continueVault(false, "continue").notice, "Sin datos");
  assert.equal(continueVault(false, "sync").go, true);
});

test("la escucha no pide api2 y Continue sin cursor no abre nada", async () => {
  const gotos: string[] = [];
  let scrolled = false;
  let waited = 0;
  let handler: ((response: { url(): string; status(): number; text(): Promise<string> }) => void) | null = null;
  const page: VaultPageLike = {
    async goto(url) {
      gotos.push(url);
      handler?.({
        url: () => "https://onlyfans.com/api2/v2/vault/media",
        status: () => 200,
        text: async () => JSON.stringify({
          hasMore: false,
          folders: [{ id: "sola", type: "folder", name: "SOLA" }],
          list: [{ id: "v1", type: "video", name: "tarde", duration: 180, listId: "sola" }],
        }),
      });
    },
    on(_event, next) { handler = next; },
    off() { handler = null; },
    async scroll() { scrolled = true; },
  };
  const read = await captureVault(page, "https://onlyfans.com", "sync", {
    wait: async (ms) => { waited = ms; },
  });
  assert.deepEqual(gotos, ["https://onlyfans.com/my/vault"]);
  assert.equal(waited, 5_000);
  assert.equal(scrolled, false);
  assert.equal(read.items[0]?.id, "v1");
  assert.equal(read.items[0]?.couple, "SOLA");
  assert.equal(read.done, true);
  const stopped = await captureVault(page, "https://onlyfans.com", "continue", { hasCursor: false, wait: async () => undefined });
  assert.equal(stopped.notice, "Sin datos");
  assert.deepEqual(gotos, ["https://onlyfans.com/my/vault"]);
});

test("el precio sugerido sigue la banda y el histórico, y no inventa duración", () => {
  assert.equal(suggestPriceCents({ seconds: null, couple: "SOLA", act: null }), null);
  assert.equal(suggestPriceCents({ seconds: 180, couple: null, act: null }), null);
  assert.equal(suggestPriceCents({ seconds: 180, couple: "SOLA", act: null }), 1200);
  assert.equal(suggestPriceCents({ seconds: 15 * 60, couple: "SOLA", act: null }), 1620);
  assert.equal(suggestPriceCents({ seconds: 20 * 60, couple: "SOLA", act: null }), 1700);
  assert.equal(suggestPriceCents({ seconds: 60, couple: "SOLA", act: "anal" }), 1700);
  assert.equal(suggestPriceCents({ seconds: 60, couple: "B/G", act: null }), 1900);
  assert.equal(suggestPriceCents({ seconds: 20 * 60, couple: "G/G", act: null }), 2900);
  assert.equal(suggestPriceCents({ seconds: 60, couple: "PELICULA", act: null }), 1700);
  assert.equal(suggestPriceCents({ seconds: 180, couple: "SOLA", act: null, purchases: [{ priceCents: 1300, purchased: true }] }), 1400);
  assert.equal(suggestPriceCents({ seconds: 180, couple: "SOLA", act: null, purchases: [{ priceCents: 1300, purchased: false }] }), 1200);
  assert.equal(suggestPriceCents({ seconds: 180, couple: "SOLA", act: null, purchases: [{ priceCents: 5000, purchased: true }] }), 1700);
  assert.equal(PRICE_RULE_LABEL, "Regla");
  assert.equal(priceRuleFromEnv(undefined).soloMin, 1200);
  assert.equal(priceRuleFromEnv("{\"soloMin\":1500}").soloMin, 1500);
  assert.equal(priceRuleFromEnv("no-json").soloMin, 1200);
  assert.equal(sendBlock("No-vender"), "NO VENDER");
  assert.equal(sendBlock("no vender"), "NO VENDER");
  assert.equal(sendBlock("SIN-EDITAR"), "SIN EDITAR");
  const folders = [
    { id: "root", name: "NO VENDER", parentId: null },
    { id: "child", name: "tarde", parentId: "root" },
  ];
  assert.equal(inheritedBlock(folders, "child"), "NO VENDER");
  assert.equal(inheritedBlock([{ id: "ok", name: "SOLA", parentId: null }], "ok"), null);
  assert.equal(inheritedBlock([{ id: "child", name: "tarde", parentId: "falta" }], "child"), "NO VENDER");
  assert.equal(inheritedBlock([], "falta"), "NO VENDER");
  const hidden = vaultForRole({ sales: 4, priceCents: 1200 }, false);
  assert.equal(hidden.sales, null);
  assert.equal(hidden.priceCents, null);
});

test("NO VENDER y SIN EDITAR no se adjuntan, y el historial avisa solo si consta", () => {
  const blocked = { ...sola, blocked: "NO VENDER" as const };
  assert.deepEqual(attachVaultItem(blocked), { ok: false, notice: "NO VENDER" });
  assert.equal(attachVaultItem({ ...sola, title: "clip SIN EDITAR", blocked: "SIN EDITAR" }).ok, false);
  const sends = sendsFromMessages([{
    fromFan: false,
    fanKey: "7",
    sentAt: "2026-11-02T10:00:00.000Z",
    priceCents: 1500,
    purchased: true,
    authorName: "Elena",
    media: [{ vaultId: "v1" }],
  }, {
    fromFan: true,
    fanKey: "7",
    sentAt: "2026-11-02T11:00:00.000Z",
    priceCents: null,
    purchased: null,
    authorName: null,
    media: [{ vaultId: "v1" }],
  }]);
  const hit = sendToFan(sends, "v1", "7");
  assert.equal(hit?.chatterName, "Elena");
  assert.equal(hit?.purchased, true);
  assert.equal(hit?.priceCents, 1500);
  assert.equal(sendToFan(sends, "v1", null), null);
  assert.equal(sendToFan(sends, "otro", "7"), null);
});

test("los filtros se combinan, el árbol de carpetas limita la búsqueda y se recuerdan por chatter", () => {
  const folders = [
    { id: "pareja", name: "Pareja", parentId: null },
    { id: "bg", name: "B/G", parentId: "pareja" },
  ];
  const child: VaultItem = { ...sola, id: "v2", folderId: "bg", couple: "B/G", title: "noche", tags: ["sent"], seconds: 30, createdAt: "2026-11-05T10:00:00.000Z", sales: 9, trailer: true, priceCents: 0 };
  const outside: VaultItem = { ...sola, id: "v3", folderId: "otra", title: "lejos" };
  const sends = sendsFromMessages([{
    fromFan: false, fanKey: "7", sentAt: "2026-11-06T00:00:00.000Z", priceCents: 1900, purchased: false, authorName: "Ana", media: [{ vaultId: "v2" }],
  }]);
  const inFolder = applyVaultFilters([sola, child, outside], folders, { ...EMPTY_FILTERS, folderId: "pareja", scope: "carpeta" }, [], null);
  assert.deepEqual(inFolder.map((item) => item.id), ["v2"]);
  const whole = applyVaultFilters([sola, child, outside], folders, { ...EMPTY_FILTERS, text: "lejos", scope: "boveda" }, [], null);
  assert.deepEqual(whole.map((item) => item.id), ["v3"]);
  const sent = applyVaultFilters([sola, child], folders, { ...EMPTY_FILTERS, listId: "sent", sentToFan: true, priceKind: "gratis", kind: "video", sort: "ventas" }, sends, "7");
  assert.deepEqual(sent.map((item) => item.id), ["v2"]);
  assert.equal(folderTree(folders, "pareja").has("bg"), true);
  assert.equal(filterStorageKey(null), null);
  assert.equal(filterStorageKey("elena"), "fanlink-vault-filters:elena");
  assert.equal(decodeFilters(encodeFilters({ ...EMPTY_FILTERS, text: "sola", sort: "precio" })).text, "sola");
  assert.equal(decodeFilters("{").sort, "fecha");
  const shown = vaultForBrowser(sola);
  assert.equal("full" in shown, false);
  assert.equal("preview" in shown, false);
  assert.equal(shown.hasPreview, true);
});
