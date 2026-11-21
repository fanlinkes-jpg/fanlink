import assert from "node:assert/strict";
import test from "node:test";
import { parseVaultBundle, stampVaultList, videoShapeLine } from "../sync/vault-model.ts";
import { playbackUrl } from "../sync/vault-store.ts";
import { clearVaultThumbs, fetchVaultMedia, getVaultThumb, hasFtyp, putVaultThumb, VIDEO_FETCH_TIMEOUT_MS, videoBytesAccepted, videoFollowUp } from "../sync/media-bytes.ts";
import { noteVaultPlayRequest } from "../http/vault-http.ts";
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
  assert.equal(video?.clipUrl, video?.fullUrl);
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
  assert.deepEqual(shared.items[0]?.listIds ?? [], ["501"]);
  assert.deepEqual(stampVaultList(shared.items[0]!, "501", null).listIds, ["501"]);
});

test("un vídeo con la forma real usa el mp4 y no la miniatura", () => {
  const video = parseVaultBundle({
    list: [{
      id: 9,
      type: "video",
      files: {
        full: { url: "https://cdn2.onlyfans.com/files/poster.jpg", sources: [{ url: "https://cdn2.onlyfans.com/files/full.mp4" }] },
        thumb: { url: "https://cdn2.onlyfans.com/files/t.jpg" },
        preview: { url: "https://cdn2.onlyfans.com/files/p.jpg" },
        squarePreview: { url: "https://cdn2.onlyfans.com/files/s.jpg" },
      },
      source: { source: "https://cdn2.onlyfans.com/files/source.mp4" },
      videoSources: { "240": "https://cdn2.onlyfans.com/files/240.mp4", "720": "https://cdn2.onlyfans.com/files/720.mp4" },
    }],
  }).items[0];
  assert.equal(video?.fullUrl, "https://cdn2.onlyfans.com/files/full.mp4");
  assert.equal(video?.fullUrl?.endsWith(".jpg"), false);
  assert.equal(playbackUrl({ full: video?.fullUrl ?? null, clip: "https://cdn2.onlyfans.com/files/t.jpg", preview: "https://cdn2.onlyfans.com/files/p.jpg", thumb: "https://cdn2.onlyfans.com/files/t.jpg" }, "full", "video"), video?.fullUrl);
  assert.equal(playbackUrl({ full: "https://cdn2.onlyfans.com/files/t.jpg", clip: null, preview: "https://cdn2.onlyfans.com/files/p.jpg", thumb: "https://cdn2.onlyfans.com/files/t.jpg" }, "full", "video"), null);
  assert.equal(videoBytesAccepted("video/mp4"), true);
  assert.equal(videoBytesAccepted("image/jpeg"), false);
  assert.equal(videoBytesAccepted("application/octet-stream", Uint8Array.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70])), true);
  assert.equal(videoBytesAccepted(""), false);
  assert.equal(hasFtyp(Uint8Array.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70])), true);
  assert.equal(videoFollowUp(403, "image/jpeg", true), "drop");
  assert.equal(videoFollowUp(403, null, true), "refresh");
  const bare = parseVaultBundle({
    list: [{
      id: 8,
      type: "video",
      files: {
        full: { url: "https://cdn3.onlyfans.com/files/abc?Policy=sek" },
        thumb: { url: "https://cdn2.onlyfans.com/files/t.jpg" },
      },
    }],
  }).items[0];
  assert.equal(bare?.fullUrl, "https://cdn3.onlyfans.com/files/abc?Policy=sek");
  const jose = videoShapeLine({
    files: { full: { url: "https://cdn2.onlyfans.com/files/a.mp4" } },
    videoSources: { "240": "https://cdn2.onlyfans.com/files/240.mp4", "720": null },
  });
  assert.equal(jose.includes("https"), false);
  assert.match(jose, /files\.full=objeto url:ext/);
  assert.match(jose, /240:ext/);
  assert.match(jose, /720:ausente/);
  const allisonRow = {
    id: 3,
    type: "video",
    files: { full: { url: "https://cdn2.onlyfans.com/files/poster.jpg" } },
    videoSources: { "720": { src: "https://cdn3.onlyfans.com/file/abc?Policy=sek&Signature=abc" } },
  };
  const allison = videoShapeLine(allisonRow);
  assert.equal(allison.includes("https://"), false);
  assert.equal(allison.includes("sek"), false);
  assert.match(allison, /files\.full=objeto url:imagen/);
  assert.match(allison, /720:objeto url:ausente src:sin-ext\+firma/);
  const played = parseVaultBundle({ list: [allisonRow] }).items[0];
  assert.equal(played?.fullUrl, "https://cdn3.onlyfans.com/file/abc?Policy=sek&Signature=abc");
  assert.equal(played?.clipUrl, played?.fullUrl);
  const poster = parseVaultBundle({
    list: [{
      id: 4,
      type: "video",
      files: { full: { url: "https://cdn2.onlyfans.com/files/poster.jpg", src: "https://cdn3.onlyfans.com/file/abc?Policy=sek" } },
    }],
  }).items[0];
  assert.equal(poster?.fullUrl, "https://cdn3.onlyfans.com/file/abc?Policy=sek");
  assert.equal(poster?.clipUrl, poster?.fullUrl);
  clearVaultThumbs();
  putVaultThumb("c-1", "9", Uint8Array.from([1]), "image/jpeg", "preview");
  assert.equal(getVaultThumb("c-1", "9", "full"), null);
  assert.equal(getVaultThumb("c-1", "9", "preview")?.contentType, "image/jpeg");
  const catalog = parseVaultBundle({
    list: [{ id: 1, type: "photo", listStates: [{ id: 10, hasMedia: true }, { id: 11, hasMedia: true }] }],
  }).items[0];
  assert.deepEqual(catalog?.listIds ?? [], []);
});

test("cada Ver deja una línea y la descarga de un vídeo se aborta a los 20 s", async () => {
  const lines: string[] = [];
  const previousInfo = console.info;
  console.info = ((line?: unknown) => { lines.push(String(line ?? "")); }) as typeof console.info;
  noteVaultPlayRequest(new Request("http://127.0.0.1/api/vault-media?creatorId=3zk7kbr&mediaId=v9&variant=full"));
  assert.equal(lines.some((line) => line.startsWith("[fanlink:vault] ver variant=full medio=") && !line.includes("v9") && !line.includes("http")), true);
  assert.equal(VIDEO_FETCH_TIMEOUT_MS, 20_000);
  const original = AbortSignal.timeout;
  let armed = 0;
  const timeout = ((ms: number) => {
    armed = ms;
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException("timeout", "TimeoutError")), 30);
    return controller.signal;
  }) as typeof AbortSignal.timeout;
  Object.defineProperty(AbortSignal, "timeout", { configurable: true, writable: true, value: timeout });
  const previousFetch = globalThis.fetch;
  globalThis.fetch = ((_input: unknown, init?: RequestInit) => new Promise((_resolve, reject) => {
    const signal = init?.signal;
    if (!signal) {
      reject(new Error("sin señal"));
      return;
    }
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  })) as typeof fetch;
  try {
    const result = await fetchVaultMedia("https://cdn2.onlyfans.com/files/a.mp4?Policy=sek", { accept: "video/*" }, true);
    assert.equal(armed, 20_000);
    assert.equal(result.status, 0);
    assert.equal(lines.some((line) => line.includes("reproductor error motivo=timeout")), true);
    assert.equal(lines.some((line) => line.includes("Policy") || line.includes("onlyfans")), false);
  } finally {
    Object.defineProperty(AbortSignal, "timeout", { configurable: true, writable: true, value: original });
    globalThis.fetch = previousFetch;
    console.info = previousInfo;
  }
});

test("un 206 a mitad de archivo no exige ftyp y el principio sin ftyp no se sirve", async () => {
  const previous = globalThis.fetch;
  try {
    globalThis.fetch = (async () => new Response(Uint8Array.from([1, 2, 3, 4]), {
      status: 206,
      headers: { "content-type": "application/octet-stream", "content-range": "bytes 1000-1003/9000" },
    })) as typeof fetch;
    const middle = await fetchVaultMedia("https://cdn2.onlyfans.com/files/abc", { accept: "video/*", range: "bytes=1000-1003" }, true);
    assert.equal("contentType" in middle, true);
    globalThis.fetch = (async () => new Response(Uint8Array.from([1, 2, 3, 4]), {
      status: 200,
      headers: { "content-type": "application/octet-stream" },
    })) as typeof fetch;
    const head = await fetchVaultMedia("https://cdn2.onlyfans.com/files/abc", { accept: "video/*", range: "bytes=0-" }, true);
    assert.equal("contentType" in head, false);
  } finally {
    globalThis.fetch = previous;
  }
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
