import assert from "node:assert/strict";
import test from "node:test";
import { parseVaultBundle, stampVaultList } from "../sync/vault-model.ts";
import { folderColumnView } from "../../../src/lib/vault-folder-label.ts";

test("los conteos aceptan string, snake_case y el objeto counts, y Todos se guarda", () => {
  const bundle = parseVaultBundle({
    list: [{
      id: "ducha",
      type: "custom",
      name: "B/G LA DUCHA",
      has_media: true,
      counts: { photos_count: "4", videos_count: "2" },
    }],
    all: { photosCount: "22", videosCount: "18", gifsCount: "1", audiosCount: "0" },
  });
  const folder = bundle.lists.find((list) => list.id === "ducha");
  assert.equal(folder?.photos, 4);
  assert.equal(folder?.videos, 2);
  assert.equal(folder?.hasMedia, true);
  const all = bundle.lists.find((list) => list.id === "all");
  assert.equal(all?.photos, 22);
  assert.equal(all?.videos, 18);
});

test("el medio usa hasPosts, hasMessages y messagesCount, no las compras", () => {
  const bundle = parseVaultBundle({
    list: [{
      id: 9,
      type: "video",
      duration: "12",
      createdAt: "2026-01-02T00:00:00.000Z",
      hasPosts: true,
      hasMessages: true,
      price: "5.00",
      counters: { messagesCount: "3", buyersCount: 9, tipsSumm: "100" },
      files: {
        thumb: { url: "https://cdn2.onlyfans.com/files/t.jpg" },
        preview: { url: "https://cdn2.onlyfans.com/files/p.jpg" },
        squarePreview: { url: "https://cdn2.onlyfans.com/files/s.jpg" },
        full: { url: "https://cdn2.onlyfans.com/files/f.mp4" },
      },
      videoSources: { "720": null, "240": "https://cdn2.onlyfans.com/files/light.mp4" },
    }, {
      id: 10,
      type: "photo",
    }],
  });
  const video = bundle.items.find((item) => item.id === "9");
  assert.equal(video?.seconds, 12);
  assert.equal(video?.priceCents, 500);
  assert.equal(video?.sentCount, 3);
  assert.equal(video?.tags.includes("Feed"), true);
  assert.equal(video?.tags.includes("Sent"), true);
  assert.equal(video?.thumbUrl, "https://cdn2.onlyfans.com/files/t.jpg");
  assert.equal(video?.fullUrl, "https://cdn2.onlyfans.com/files/f.mp4");
  assert.equal(video?.clipUrl, "https://cdn2.onlyfans.com/files/light.mp4");
  const photo = bundle.items.find((item) => item.id === "10");
  assert.equal(photo?.tags.includes("Feed"), false);
  const inPosts = parseVaultBundle({
    list: [{
      id: 11,
      type: "photo",
      listStates: [{ id: "30436422", type: "posts", name: "Posts" }],
    }],
  }).items.find((item) => item.id === "11");
  assert.equal(inPosts?.tags.includes("Feed"), false);
  assert.equal(photo?.tags.includes("Feed:no"), false);
  assert.equal(photo?.sentCount, null);
  assert.equal(photo?.priceCents, null);
  assert.equal(photo?.clipUrl ?? null, null);
  const stamped = stampVaultList({ ...photo!, folder: null, listName: null }, "ducha", "B/G LA DUCHA");
  assert.equal(stamped.folder, "B/G LA DUCHA");
  assert.equal(stamped.listName, "B/G LA DUCHA");
  assert.deepEqual(stamped.listIds, ["ducha"]);
});

test("dos cuentas conservan el conteo y las portadas de cada carpeta, no los de Todos", () => {
  const library = [
    ...Array.from({ length: 40 }, (_, index) => ({ id: `lib-${index}`, kind: "foto" as const })),
    { id: "lib-v", kind: "video" as const },
    { id: "lib-g", kind: "gif" as const },
  ];
  const accounts = [
    accountShape([400, 80, 3, 1], [
      { id: 501, name: "Carpeta norte", counts: [9, 2, 0, 0], covers: [{ id: 701, type: "photo" }, { id: 702, type: "video" }] },
      { id: 502, name: "Carpeta sur", counts: [1, 6, 1, 0], covers: [{ id: 703, type: "photo" }] },
    ]),
    accountShape([20, 4, 0, 0], [
      { id: 601, name: "Carpeta este", counts: [5, 1, 0, 2], covers: [{ id: 801, type: "gif" }] },
      { id: 602, name: "Carpeta oeste", counts: [0, 3, 0, 0], covers: [{ id: 802, type: "video" }] },
    ]),
  ];
  const labels = accounts.map((payload) => {
    const bundle = parseVaultBundle(payload);
    const all = bundle.lists.find((list) => list.id === "all");
    return bundle.lists.filter((list) => list.id !== "all").map((folder) => {
      const column = folderColumnView({
        counts: { photos: folder.photos ?? null, videos: folder.videos ?? null, gifs: folder.gifs ?? null, audios: folder.audios ?? null, hasMedia: folder.hasMedia ?? null },
        covers: folder.covers ?? [],
        ownItems: library,
      });
      return { id: folder.id, label: column.label, coverIds: column.coverIds, allPhotos: all?.photos, allVideos: all?.videos };
    });
  });
  assert.equal(labels[0]?.find((row) => row.id === "501")?.label, "9 fotos · 2 vídeos");
  assert.deepEqual(labels[0]?.find((row) => row.id === "501")?.coverIds, ["701", "702"]);
  assert.equal(labels[0]?.find((row) => row.id === "502")?.label, "1 foto · 6 vídeos · 1 GIF");
  assert.deepEqual(labels[0]?.find((row) => row.id === "502")?.coverIds, ["703"]);
  assert.equal(labels[1]?.find((row) => row.id === "601")?.label, "5 fotos · 1 vídeo · 2 audios");
  assert.deepEqual(labels[1]?.find((row) => row.id === "601")?.coverIds, ["801"]);
  assert.equal(labels[1]?.find((row) => row.id === "602")?.label, "0 fotos · 3 vídeos");
  assert.deepEqual(labels[1]?.find((row) => row.id === "602")?.coverIds, ["802"]);
  for (const row of labels.flat()) {
    assert.equal(row.label.includes(String(row.allPhotos)), false);
    assert.equal(row.coverIds.includes("lib-0"), false);
  }
  const shared = parseVaultBundle({
    list: [{
      id: 900,
      type: "photo",
      listStates: [
        { id: 501, type: "custom", name: "Carpeta norte", hasMedia: true, canAddMedia: true },
        { id: 502, type: "custom", name: "Carpeta sur", hasMedia: false, canAddMedia: true },
        { id: 601, type: "custom", name: "Carpeta este", hasMedia: false, canAddMedia: false },
      ],
    }],
  });
  assert.deepEqual(shared.items[0]?.listIds, ["501"]);
});

function accountShape(
  all: [number, number, number, number],
  folders: Array<{ id: number; name: string; counts: [number, number, number, number]; covers: Array<{ id: number; type: string }> }>,
) {
  return {
    list: folders.map((folder) => ({
      id: folder.id,
      type: "custom",
      name: folder.name,
      hasMedia: true,
      canUpdate: true,
      canDelete: true,
      photosCount: folder.counts[0],
      videosCount: folder.counts[1],
      gifsCount: folder.counts[2],
      audiosCount: folder.counts[3],
      medias: folder.covers.map((cover) => ({ id: cover.id, type: cover.type, url: "https://cdn2.onlyfans.com/files/cover.jpg" })),
      echo: { photosCount: all[0], videosCount: all[1], gifsCount: all[2], audiosCount: all[3] },
    })),
    all: {
      photosCount: all[0],
      videosCount: all[1],
      gifsCount: all[2],
      audiosCount: all[3],
      medias: [{ type: "photo", url: "https://cdn2.onlyfans.com/files/all.jpg" }],
    },
    hasMore: false,
    canCreateVaultLists: true,
    order: "asc",
    sort: "custom",
  };
}
