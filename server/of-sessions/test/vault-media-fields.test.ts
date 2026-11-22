import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { browserVideoType, choosePlayableVideo, drmManifestUrl, drmPlaybackChoice, parseVaultBundle, resolveDetailPlayback, stampVaultList, vaultDetailRow, videoContainer, videoDetailHold, videoDrmLine, videoFlagLine, videoFormatHold, videoHoldPayload, videoHoldText, videoShapeLine } from "../sync/vault-model.ts";
import { describePlaylist, drmLicenseEnabled, forwardDrmLicense, hlsMediaResponse, hlsSegmentType, LICENSE_BODY_MAX, licenseMethodStatus, openDrmManifest, openDrmManifestResult, paceLicense, playVaultHlsDetail, protectedVideoHold, readBoundedPlaylist, widevineLicenseUrl } from "../sync/vault-hls.ts";
import { fetchSignedMediaDetail, vaultMediaDetailPath } from "../sync/of-chat-api.ts";
import { clearSignRulesCache } from "../sync/of-sign.ts";
import type { StorageStateFile } from "../sessions/storage-state.ts";
import { abortResponse, clearPlayNotes, handleVaultMedia, headRange, noteVaultPlayRequest } from "../http/vault-http.ts";
import { loadFreshPreview } from "../sync/vault-thumbs.ts";
import { playbackUrl, reuseOrRefreshVideo, VIDEO_DETAIL_PAUSE_MS } from "../sync/vault-store.ts";
import type { ReadSql } from "../sync/store.ts";
import { boundedSegmentRange, boundedVideoRange, clearVaultThumbs, fetchVaultMedia, getVaultThumb, hasFtyp, putVaultThumb, SEGMENT_RANGE_BYTES, VIDEO_FETCH_TIMEOUT_MS, VIDEO_OPEN_BYTES, videoBytesAccepted, videoFollowUp } from "../sync/media-bytes.ts";
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
  clearPlayNotes();
  noteVaultPlayRequest(new Request("http://127.0.0.1/api/vault-media?creatorId=3zk7kbr&mediaId=v9&variant=full"));
  noteVaultPlayRequest(new Request("http://127.0.0.1/api/vault-media?creatorId=3zk7kbr&mediaId=v9&variant=full"));
  const vers = lines.filter((line) => line.startsWith("[fanlink:vault] ver variant=full medio="));
  assert.equal(vers.length, 1);
  assert.equal(vers[0]?.includes("v9"), false);
  assert.equal(vers[0]?.includes("http"), false);
  const closed = new AbortController();
  closed.abort();
  const aborted = abortResponse({ name: "AbortError", message: "aborted", cause: { code: "ECONNRESET" } }, closed.signal);
  assert.equal(aborted?.status, 499);
  assert.equal(abortResponse({ code: "ECONNRESET" }), null);
  assert.equal(abortResponse(new Error("otra cosa"), closed.signal), null);
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

test("un vídeo sin url pide el detalle y acaba en video/mp4", async () => {
  const bare = {
    id: 43,
    type: "video",
    convertedToVideo: false,
    canView: true,
    hasError: false,
    isReady: true,
    files: { full: { url: null, src: null, source: null, sources: [] } },
    videoSources: { "240": null, "720": null },
  };
  const line = videoShapeLine(bare);
  assert.equal(line.includes("https"), false);
  assert.match(line, /convertedToVideo=no/);
  assert.match(line, /canView=si/);
  assert.match(line, /hasError=no/);
  assert.match(line, /isReady=si/);
  assert.match(line, /files\.full=objeto url:ausente/);
  assert.equal(choosePlayableVideo(bare), null);
  assert.equal(videoHoldText({ ...bare, isReady: false }), "Vídeo aún procesándose en OnlyFans");
  assert.equal(videoHoldText({ ...bare, hasError: true }), "OnlyFans no ha podido procesar el vídeo");
  assert.equal(vaultMediaDetailPath("43"), "/api2/v2/vault/media/43");
  clearSignRulesCache();
  const seen: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const href = String(input);
    seen.push(href.split("?")[0] ?? href);
    if (href.includes("dynamic-rules")) {
      return Response.json({
        static_param: "param",
        format: "1:{}:{:x}:2",
        checksum_indexes: [0, 1],
        checksum_constants: [5, 5],
        checksum_constant: 10,
        app_token: "token",
        remove_headers: ["user-id"],
      });
    }
    assert.equal(new URL(href).pathname, "/api2/v2/vault/media/43");
    return Response.json({
      id: 43,
      type: "video",
      convertedToVideo: false,
      canView: true,
      hasError: false,
      isReady: true,
      files: { full: { url: "https://cdn2.onlyfans.com/files/full.mp4?Policy=sek" } },
      videoSources: { "240": null, "720": null },
    });
  }) as typeof fetch;
  const detail = await fetchSignedMediaDetail(detailState(), { fetch: fetchImpl, now: () => 1_700_000_000_000 }, "43");
  const row = vaultDetailRow(detail.body);
  const chosen = row ? choosePlayableVideo(row) : null;
  assert.equal(chosen?.name, "files.full");
  assert.equal(chosen?.url, "https://cdn2.onlyfans.com/files/full.mp4?Policy=sek");
  assert.equal(seen.some((href) => href.endsWith("/api2/v2/vault/media/43")), true);
  const played = await handleVaultMedia(new Request("http://127.0.0.1/api/vault-media?creatorId=c-1&mediaId=43&variant=full"), {
    session: async () => ({ userId: "dueña", role: "owner", perms: ["vault"] }),
    findPreview: async () => chosen?.url ?? null,
    fetchBytes: async () => ({ status: 200, body: Uint8Array.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70]), contentType: "video/mp4", contentLength: 8 }),
  });
  assert.equal(played.status, 200);
  assert.equal(played.headers.get("content-type"), "video/mp4");
  const held = await handleVaultMedia(new Request("http://127.0.0.1/api/vault-media?creatorId=c-1&mediaId=43&variant=full"), {
    session: async () => ({ userId: "dueña", role: "owner", perms: ["vault"] }),
    findPreview: async () => null,
    videoHold: () => "Vídeo aún procesándose en OnlyFans",
    fetchBytes: async () => null,
  });
  assert.equal(held.status, 409);
  assert.equal(await held.text(), "Vídeo aún procesándose en OnlyFans");
  clearSignRulesCache();
});

test("part=head recorta cualquier rango al primer megabyte y un 206 no entra en la caché", async () => {
  assert.equal(headRange(null), "bytes=0-1048575");
  assert.equal(headRange("bytes=0-"), "bytes=0-1048575");
  assert.equal(headRange("bytes=500-9000000"), "bytes=0-1048575");
  assert.equal(headRange("bytes=100-"), "bytes=0-1048575");
  let seen: string | null = null;
  await handleVaultMedia(new Request("http://127.0.0.1/api/vault-media?creatorId=c-1&mediaId=v9&variant=clip&part=head", {
    headers: { range: "bytes=500-9000000" },
  }), {
    session: async () => ({ userId: "dueña", role: "owner", perms: ["vault"] }),
    findPreview: async () => "https://cdn2.onlyfans.com/files/full.mp4",
    fetchBytes: async (_url, range) => {
      seen = range ?? null;
      return { status: 206, body: Uint8Array.from([1]), contentType: "video/mp4", contentRange: "bytes 0-1048575/9" };
    },
  });
  assert.equal(seen, "bytes=0-1048575");
  const lines: string[] = [];
  const previous = console.info;
  console.info = ((line?: unknown) => { lines.push(String(line ?? "")); }) as typeof console.info;
  noteVaultPlayRequest(new Request("http://127.0.0.1/api/vault-media?creatorId=c-1&mediaId=v9&variant=clip&part=head"));
  console.info = previous;
  assert.equal(lines.some((line) => line.includes("ver variant=clip") && !line.includes("v9")), true);
  clearVaultThumbs();
  const partial = await loadFreshPreview({
    creatorId: "c-206",
    mediaId: "v9",
    url: "https://cdn2.onlyfans.com/files/t.jpg",
    read: async () => ({
      status: 206,
      media: { status: 206, body: Uint8Array.from([0xff, 0xd8, 0xff]), contentType: "image/jpeg", contentRange: "bytes 0-2/9" },
    }),
    reload: async () => null,
  });
  assert.equal(partial?.status, 206);
  assert.equal(getVaultThumb("c-206", "v9"), null);
});

test("una URL caducada en SQL pide el detalle y responde video/mp4", async () => {
  assert.equal(videoDetailHold(401, null), "OnlyFans está limitando, prueba en un momento");
  assert.equal(videoDetailHold(429, null), "OnlyFans está limitando, prueba en un momento");
  const db = new PGlite();
  const root = path.resolve(import.meta.dirname, "../../..");
  try {
    for (const file of ["0037_vault_mirror.sql", "0040_vault_full_tags.sql", "0052_vault_clip.sql"]) {
      await db.exec(await readFile(path.join(root, "migrations", file), "utf8"));
    }
    await db.exec(`insert into of_vault_item (creator_id, item_key, kind, full_url, clip_url) values ('c-1', 'v9', 'video', 'https://cdn2.onlyfans.com/files/old.mp4?Expires=1700000000', 'https://cdn2.onlyfans.com/files/old.mp4?Expires=1700000000')`);
    let paused = 0;
    let detailStatus = 0;
    clearSignRulesCache();
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const href = String(input);
      if (href.includes("dynamic-rules")) {
        return Response.json({
          static_param: "param",
          format: "1:{}:{:x}:2",
          checksum_indexes: [0, 1],
          checksum_constants: [5, 5],
          checksum_constant: 10,
          app_token: "token",
          remove_headers: ["user-id"],
        });
      }
      return Response.json({
        id: 9,
        type: "video",
        isReady: true,
        hasError: false,
        canView: true,
        convertedToVideo: false,
        files: { full: { url: "https://cdn2.onlyfans.com/files/fresh.mp4" } },
      });
    }) as typeof fetch;
    const resolved = await reuseOrRefreshVideo({
      sql: asSql(db),
      creatorId: "c-1",
      mediaId: "v9",
      variant: "full",
      now: Date.now(),
      force: false,
      pause: async (ms) => { paused = ms; },
      loadDetail: async () => {
        const detail = await fetchSignedMediaDetail(detailState(), { fetch: fetchImpl, now: () => 1_700_000_000_000 }, "v9");
        detailStatus = detail.status ?? 0;
        const row = vaultDetailRow(detail.body);
        return { url: row ? choosePlayableVideo(row)?.url ?? null : null, hold: videoDetailHold(detail.status, row) };
      },
    });
    assert.equal(paused, VIDEO_DETAIL_PAUSE_MS);
    assert.equal(detailStatus, 200);
    assert.equal(resolved.url, "https://cdn2.onlyfans.com/files/fresh.mp4");
    const saved = await db.query<{ full_url: string; clip_url: string }>("select full_url, clip_url from of_vault_item where item_key = 'v9'");
    assert.equal(saved.rows[0]?.full_url, resolved.url);
    assert.equal(saved.rows[0]?.clip_url, resolved.url);
    const played = await handleVaultMedia(new Request("http://127.0.0.1/api/vault-media?creatorId=c-1&mediaId=v9&variant=full"), {
      session: async () => ({ userId: "dueña", role: "owner", perms: ["vault"] }),
      findPreview: async () => resolved.url,
      fetchBytes: async () => ({ status: 200, body: Uint8Array.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70]), contentType: "video/mp4", contentLength: 8 }),
    });
    assert.equal(played.status, 200);
    assert.equal(played.headers.get("content-type"), "video/mp4");
  } finally {
    clearSignRulesCache();
    await db.close();
  }
});

test("dos Ver a la vez piden el detalle una sola vez", async () => {
  let calls = 0;
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const sql: ReadSql = {
    async query<T>(text: string): Promise<T[]> {
      if (text.includes("information_schema")) return [{ n: 0 } as T];
      return [];
    },
  };
  const loadDetail = async () => {
    calls += 1;
    await gate;
    return { url: "https://cdn2.onlyfans.com/files/a.mp4", hold: "" };
  };
  const base = {
    sql,
    creatorId: "c-flight",
    mediaId: "m-flight",
    now: Date.now(),
    force: false,
    pause: async () => undefined,
    loadDetail,
  };
  const first = reuseOrRefreshVideo({ ...base, variant: "full" });
  const second = reuseOrRefreshVideo({ ...base, variant: "clip" });
  release();
  const [left, right] = await Promise.all([first, second]);
  assert.equal(calls, 1);
  assert.equal(left.url, "https://cdn2.onlyfans.com/files/a.mp4");
  assert.equal(right.url, left.url);
});

test("Ver abre con un rango acotado, el salto pide bytes=N- con 206 y cancelar corta el CDN", async () => {
  const previous = globalThis.fetch;
  const ranges: string[] = [];
    const cap = VIDEO_OPEN_BYTES - 1;
    const seekEnd = 57_000_000 + VIDEO_OPEN_BYTES - 1;
  const slice = Uint8Array.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70]);
  const respond = (range: string) => {
    const match = /^bytes=(\d+)-(\d+)$/.exec(range);
    const start = Number(match?.[1] ?? 0);
    const end = Number(match?.[2] ?? start);
    return new Response(slice, {
      status: 206,
      headers: {
        "content-type": "video/mp4",
        "content-range": `bytes ${start}-${end}/114000000`,
        "content-length": String(end - start + 1),
        "accept-ranges": "bytes",
      },
    });
  };
  try {
    globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
      const range = new Headers(init?.headers).get("range") ?? "";
      ranges.push(range);
      return respond(range);
    }) as typeof fetch;
    assert.equal(boundedVideoRange(null), `bytes=0-${cap}`);
    assert.equal(boundedVideoRange("bytes=0-"), `bytes=0-${cap}`);
    assert.equal(boundedVideoRange("bytes=57000000-"), `bytes=57000000-${seekEnd}`);
    assert.equal(boundedVideoRange("bytes=0-113999999"), `bytes=0-${cap}`);
    assert.equal(boundedVideoRange("bytes=0-99"), "bytes=0-99");
    const opened = await fetchVaultMedia("https://cdn2.onlyfans.com/files/big.mp4", { accept: "video/*", range: "bytes=0-113999999" }, true);
    assert.equal(ranges[0], `bytes=0-${cap}`);
    assert.equal(opened.status, 206);
    assert.ok(VIDEO_OPEN_BYTES < 8 * 1024 * 1024);
    const played = await handleVaultMedia(new Request("http://127.0.0.1/api/vault-media?creatorId=c-1&mediaId=big&variant=full", {
      headers: { range: "bytes=57000000-" },
    }), {
      session: async () => ({ userId: "dueña", role: "owner", perms: ["vault"] }),
      findPreview: async () => "https://cdn2.onlyfans.com/files/big.mp4",
      fetchBytes: async (_url, range, signal) => {
        const served = await fetchVaultMedia("https://cdn2.onlyfans.com/files/big.mp4", { accept: "video/*", range: range ?? "" }, true, signal);
        return "contentType" in served ? served : null;
      },
    });
    assert.equal(ranges.at(-1), `bytes=57000000-${seekEnd}`);
    assert.equal(played.status, 206);
    assert.equal(played.headers.get("content-range"), `bytes 57000000-${seekEnd}/114000000`);
    assert.equal(played.headers.get("content-length"), String(VIDEO_OPEN_BYTES));
  } finally {
    globalThis.fetch = previous;
  }
  let upstream: AbortSignal | undefined;
  const client = new AbortController();
  globalThis.fetch = (async (_input: unknown, init?: RequestInit) => new Promise((_resolve, reject) => {
    upstream = init?.signal ?? undefined;
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
    const pending = fetchVaultMedia("https://cdn2.onlyfans.com/files/big.mp4", { accept: "video/*", range: "bytes=57000000-" }, true, client.signal);
    client.abort();
    const cancelled = await pending;
    assert.equal(upstream?.aborted, true);
    assert.equal(cancelled.status, 0);
  } finally {
    globalThis.fetch = previous;
  }
});

test("un detalle con convertedToVideo=no se reproduce por HLS y no abre OnlyFans", async () => {
  const detail = {
    id: 24,
    type: "video",
    convertedToVideo: false,
    canView: true,
    hasError: false,
    isReady: true,
    files: {
      full: { url: null, src: null, source: null, sources: [] },
      drm: {
        manifest: {
          hls: "https://cdn2.onlyfans.com/hls/files/a.m3u8?Tag=2",
          dash: "https://cdn2.onlyfans.com/dash/files/a.mpd?Tag=2",
        },
        signature: { hls: { "CloudFront-Policy": "sek", "CloudFront-Signature": "sigvalue", "CloudFront-Key-Pair-Id": "keypair" } },
      },
    },
    videoSources: { "240": null, "720": null },
  };
  const row = vaultDetailRow(detail);
  assert.ok(row);
  assert.equal(choosePlayableVideo(row), null);
  const line = `${videoShapeLine(row)} ${videoDrmLine(row)}`;
  assert.match(line, /convertedToVideo=no/);
  assert.match(line, /canView=si/);
  assert.match(line, /hasError=no/);
  assert.match(line, /isReady=si/);
  assert.match(line, /drm=si manifest=hls\+dash/);
  assert.equal(line.includes("m3u8"), false);
  assert.equal(line.includes("mpd"), false);
  assert.equal(line.includes("sek"), false);
  assert.equal(line.includes("CloudFront"), false);
  const payload = videoHoldPayload(200, row);
  assert.equal(payload.abrir, false);
  assert.equal(drmManifestUrl({ files: { drm: { manifest: { hls: "https://evil.example/a.m3u8" } } } }), null);
  assert.equal(await readBoundedPlaylist("https://evil.example/a.m3u8", async () => {
    throw new Error("no se pide");
  }), null);
  assert.equal(hlsSegmentType("https://cdn2.onlyfans.com/a.ts", "video/mp4"), "video/mp2t");
  assert.equal(hlsSegmentType("https://cdn2.onlyfans.com/a.m4s", "video/mp4"), "video/iso.segment");
  assert.equal(hlsSegmentType("https://cdn2.onlyfans.com/a.mpd", "application/vnd.apple.mpegurl"), "application/dash+xml");
  const master = "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000\n720/index.m3u8\n";
  const media = "#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-KEY:METHOD=SAMPLE-AES,URI=\"https://onlyfans.com/drm/license\",KEYFORMAT=\"urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed\",KEYFORMATVERSIONS=\"1\"\n#EXTINF:6.0,\nseg-0.m4s\n#EXTINF:6.0,\nseg-1.m4s\n#EXT-X-ENDLIST\n";
  const ftyp = Uint8Array.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 1]);
  const ftypB = Uint8Array.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 2]);
  let pauses = 0;
  const cookies: string[] = [];
  let licenseBody = "";
  let licenseCookie = "";
  const fetchImpl = (async (input: unknown, init?: RequestInit) => {
    const href = String(input);
    const cookie = new Headers(init?.headers).get("cookie") ?? "";
    cookies.push(cookie);
    if (init?.method === "POST") {
      licenseCookie = cookie;
      licenseBody = await new Response(init.body).text();
      return new Response("license-ok", { status: 200, headers: { "content-type": "application/octet-stream" } });
    }
    if (href.includes("/hls/files/a.m3u8")) return new Response(master, { status: 200, headers: { "content-type": "application/vnd.apple.mpegurl" } });
    if (href.endsWith("/index.m3u8")) return new Response(media, { status: 200, headers: { "content-type": "application/vnd.apple.mpegurl" } });
    if (href.endsWith("seg-0.m4s")) return new Response(ftyp, { status: 200, headers: { "content-type": "video/mp4", "content-length": String(ftyp.byteLength) } });
    if (href.endsWith("seg-1.m4s")) return new Response(ftypB, { status: 206, headers: { "content-type": "video/mp4", "content-range": "bytes 0-12/13", "content-length": String(ftypB.byteLength) } });
    if (href.includes(".mpd")) return new Response("<MPD></MPD>", { status: 200, headers: { "content-type": "application/dash+xml" } });
    return new Response("no", { status: 404 });
  }) as typeof fetch;
  const logs: string[] = [];
  const previousInfo = console.info;
  console.info = (...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  };
  try {
    const played = await playVaultHlsDetail(detail, fetchImpl, async () => {
      pauses += 1;
    }, { creatorId: "u1fpdnp", mediaId: "24", sessionCookie: "sess=ok", origin: "https://fanlink.local" });
    assert.ok(played);
    assert.equal(pauses, 1);
    assert.equal(played.manifest.includes("cdn"), false);
    assert.equal(played.manifest.includes("sek"), false);
    assert.equal(played.manifest.includes("sigvalue"), false);
    assert.equal(played.manifest.includes("keypair"), false);
    assert.equal(played.mediaPlaylist.includes("cdn"), false);
    const segmentLines = played.mediaPlaylist.split(/\n/).filter((item) => !item.startsWith("#") && item.includes("variant=hls"));
    assert.equal(segmentLines.length, 2);
    assert.equal(played.contentType, "video/iso.segment");
    assert.equal(hasFtyp(played.segment), true);
    const secondUrl = new URL(segmentLines[1] ?? "", "https://fanlink.local");
    const second = await hlsMediaResponse({
      creatorId: secondUrl.searchParams.get("creatorId") ?? "",
      mediaId: secondUrl.searchParams.get("mediaId") ?? "",
      ticket: secondUrl.searchParams.get("k") ?? "",
      segment: secondUrl.searchParams.get("s") ?? "",
      range: null,
    }, fetchImpl);
    assert.equal(second.status, 206);
    assert.equal(second.headers.get("content-type"), "video/iso.segment");
    assert.equal(second.headers.get("content-range"), "bytes 0-12/13");
    assert.equal(second.headers.get("content-length"), String(ftypB.byteLength));
    const keyLine = played.mediaPlaylist.split(/\n/).find((item) => item.includes("EXT-X-KEY")) ?? "";
    const licenseUri = /URI="([^"]+)"/.exec(keyLine)?.[1] ?? "";
    assert.equal(licenseUri.includes("onlyfans.com"), false);
    assert.equal(licenseUri.includes("sek"), false);
    assert.match(licenseUri, /variant=licencia/);
    const licenseUrl = new URL(licenseUri, "https://fanlink.local");
    process.env.FANLINK_ENABLE_DRM_LICENSE = "true";
    const license = await forwardDrmLicense({
      creatorId: licenseUrl.searchParams.get("creatorId") ?? "",
      mediaId: licenseUrl.searchParams.get("mediaId") ?? "",
      ticket: licenseUrl.searchParams.get("k") ?? "",
      segment: licenseUrl.searchParams.get("s") ?? "",
      body: new TextEncoder().encode("widevine-challenge"),
      contentType: "application/octet-stream",
    }, fetchImpl);
    delete process.env.FANLINK_ENABLE_DRM_LICENSE;
    assert.equal(license.status, 200);
    assert.equal(await license.text(), "license-ok");
    assert.equal(licenseBody, "widevine-challenge");
    assert.equal(licenseCookie.includes("sess=ok"), true);
    assert.equal(licenseCookie.includes("CloudFront-Policy"), false);
    const denied = await hlsMediaResponse({
      creatorId: "otra",
      mediaId: secondUrl.searchParams.get("mediaId") ?? "",
      ticket: secondUrl.searchParams.get("k") ?? "",
      segment: secondUrl.searchParams.get("s") ?? "",
      range: null,
    }, fetchImpl);
    assert.equal(denied.status, 404);
    const secondBytes = new Uint8Array(await second.arrayBuffer());
    assert.equal(secondBytes.at(-1), 2);
    assert.notEqual(played.segment.at(-1), secondBytes.at(-1));
    const viewer = await handleVaultMedia(new Request("http://127.0.0.1/api/vault-media?creatorId=c-1&mediaId=24&variant=full"), {
      session: async () => ({ userId: "dueña", role: "owner", perms: ["vault"] }),
      findPreview: async () => "https://cdn2.onlyfans.com/hls/media.m3u8",
      fetchBytes: async () => ({ status: 200, body: new TextEncoder().encode(played.manifest), contentType: "application/vnd.apple.mpegurl" }),
    });
    assert.equal(viewer.status, 200);
    assert.equal(viewer.headers.get("content-type"), "application/vnd.apple.mpegurl");
    const viewerBody = await viewer.text();
    assert.equal(viewerBody.includes("sek"), false);
    assert.equal(viewerBody.includes("cdn2"), false);
    assert.equal(viewerBody.startsWith("#EXTM3U"), true);
    const joined = logs.join("\n");
    assert.match(joined, /reproductor hls tipo=manifest lista=master/);
    assert.match(joined, /reproductor hls tipo=manifest lista=media/);
    assert.match(joined, /firma=si/);
    assert.match(joined, /reproductor hls tipo=segmento firma=si/);
    assert.match(joined, /reproductor hls tipo=licencia status=200 firma=si/);
    assert.equal(joined.includes("sek"), false);
    assert.equal(joined.includes("sigvalue"), false);
    assert.equal(joined.includes("keypair"), false);
    const cdnCookies = cookies.filter((cookie) => cookie.includes("CloudFront-Policy"));
    assert.ok(cdnCookies.length > 0);
    assert.ok(cdnCookies.every((cookie) => !cookie.includes("sess")));
    assert.equal(drmManifestUrl({ files: { drm: { manifest: { hls: "https://d111.cloudfront.net/a.m3u8" } } } })?.includes("cloudfront.net"), true);
  } finally {
    console.info = previousInfo;
  }
});

test("convertedToVideo=no con lista usa el mismo reproductor que el mp4", async () => {
  const jose = {
    type: "video",
    convertedToVideo: false,
    canView: true,
    hasError: false,
    isReady: true,
    files: { full: { url: "https://cdn2.onlyfans.com/files/jose.mp4?Policy=sek" } },
  };
  let reads = 0;
  const direct = await resolveDetailPlayback(jose, async () => { reads += 1; return null; }, async () => undefined);
  assert.equal(direct.via, "archivo");
  assert.equal(direct.url, jose.files.full.url);
  assert.equal(reads, 0);
  const row = {
    id: 24,
    type: "video",
    convertedToVideo: false,
    canView: true,
    hasError: false,
    isReady: true,
    files: {
      full: { url: null, sources: [] },
      drm: { manifest: { hls: "https://cdn2.onlyfans.com/hls/files/a.m3u8?Policy=sek" } },
    },
    videoSources: { "240": null, "720": null },
  };
  assert.equal(choosePlayableVideo(row), null);
  assert.match(videoDrmLine(row), /drm=si manifest=hls/);
  assert.equal(videoDrmLine(row).includes("sek"), false);
  const resolved = await resolveDetailPlayback(row, async () => "#EXTM3U\nhttps://cdn2.onlyfans.com/files/full.mp4\n", async () => undefined);
  assert.equal(resolved.via, "lista");
  assert.equal(resolved.url, "https://cdn2.onlyfans.com/files/full.mp4");
  const played = await handleVaultMedia(new Request("http://127.0.0.1/api/vault-media?creatorId=u1fpdnp&mediaId=24&variant=full", {
    headers: { range: "bytes=0-" },
  }), {
    session: async () => ({ userId: "dueña", role: "owner", perms: ["vault"] }),
    findPreview: async () => resolved.url,
    fetchBytes: async () => ({ status: 206, body: Uint8Array.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70]), contentType: "video/mp4", contentRange: "bytes 0-7/8", contentLength: 8 }),
  });
  assert.equal(played.status, 206);
  assert.equal(played.headers.get("content-type"), "video/mp4");
});

test("un original con ftyp qt se sirve como video/mp4 porque Chrome no reproduce video/quicktime, y un avi no", async () => {
  const qt = Uint8Array.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x71, 0x74, 0x20, 0x20]);
  const avi = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x41, 0x56, 0x49, 0x20]);
  assert.equal(videoContainer({ head: qt }), "mov");
  assert.equal(browserVideoType("mov"), "video/mp4");
  assert.equal(videoContainer({ head: avi }), "avi");
  assert.equal(browserVideoType("avi"), null);
  const row = {
    type: "video",
    convertedToVideo: false,
    canView: true,
    hasError: false,
    isReady: true,
    files: { source: { url: "https://cdn2.onlyfans.com/files/original.mov?Policy=sek" }, full: { url: null } },
  };
  const line = videoFlagLine(row);
  assert.match(line, /convertedToVideo=no/);
  assert.match(line, /tipo=mov/);
  assert.equal(line.includes("sek"), false);
  assert.equal(line.includes("onlyfans"), false);
  const previous = globalThis.fetch;
  globalThis.fetch = (async () => new Response(qt, { status: 200, headers: { "content-type": "application/octet-stream" } })) as typeof fetch;
  try {
    const served = await fetchVaultMedia("https://cdn2.onlyfans.com/files/original.mov", { accept: "video/*", range: "bytes=0-" }, true);
    assert.equal("contentType" in served ? served.contentType : "", "video/mp4");
  } finally {
    globalThis.fetch = previous;
  }
  const blocked = videoFormatHold("avi");
  assert.equal(blocked?.abrir, true);
  assert.match(blocked?.texto ?? "", /AVI/);
  const held = await handleVaultMedia(new Request("http://127.0.0.1/api/vault-media?creatorId=u1fpdnp&mediaId=24&variant=full"), {
    session: async () => ({ userId: "dueña", role: "owner", perms: ["vault"] }),
    findPreview: async () => null,
    videoHold: () => JSON.stringify(blocked),
    fetchBytes: async () => null,
  });
  const body = await held.text();
  assert.equal(body.includes("sek"), false);
  assert.equal(JSON.parse(body).abrir, true);
});

test("un drm=si en Chrome sigue el DASH, la licencia y un solo manifiesto", async () => {
  const previous = process.env.FANLINK_ENABLE_DRM_LICENSE;
  const previousInfo = console.info;
  process.env.FANLINK_ENABLE_DRM_LICENSE = "true";
  const detail = {
    id: 24,
    type: "video",
    convertedToVideo: false,
    canView: true,
    hasError: false,
    isReady: true,
    files: {
      full: { url: null },
      drm: {
        manifest: {
          hls: "https://cdn3.onlyfans.com/hls/a.m3u8",
          dash: "https://onlyfans.com/dash/a.mpd",
        },
        signature: { dash: { "CloudFront-Policy": "sek", "CloudFront-Signature": "sigvalue", "CloudFront-Key-Pair-Id": "keypair" } },
      },
    },
  };
  assert.equal(drmPlaybackChoice(detail)?.kind, "dash");
  assert.equal(drmLicenseEnabled(), true);
  assert.equal(widevineLicenseUrl("24"), "https://onlyfans.com/api2/v2/users/media/24/drm/?type=widevine");
  assert.equal(widevineLicenseUrl("24", { kind: "post", id: "8" }), "https://onlyfans.com/api2/v2/users/media/24/drm/post/8?type=widevine");
  assert.equal(widevineLicenseUrl("24", { kind: "message", id: "9" }), "https://onlyfans.com/api2/v2/users/media/24/drm/message/9?type=widevine");
  assert.equal(widevineLicenseUrl("24", { kind: "post", id: "no" }), null);
  assert.equal(widevineLicenseUrl("abc"), null);
  const pro = btoa("<WRMHEADER><DATA><LA_URL>https://license.pallycon.com/ri/licenseManager.do</LA_URL></DATA></WRMHEADER>");
  const mpd = `<?xml version="1.0"?><MPD xmlns:cenc="urn:mpeg:cenc:2013" xmlns:mspr="urn:microsoft:playready"><Period><AdaptationSet><ContentProtection schemeIdUri="urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed"><cenc:pssh>AAAA</cenc:pssh></ContentProtection><ContentProtection schemeIdUri="urn:uuid:9a04f079-9840-4286-ab92-e65be0885f95"><cenc:pssh>BBBB</cenc:pssh><mspr:pro>${pro}</mspr:pro></ContentProtection><Representation id="240" bandwidth="200000"><BaseURL>240/file.mp4</BaseURL><SegmentBase indexRange="100-200"><Initialization range="0-99"/></SegmentBase></Representation><Representation id="720" bandwidth="800000"><BaseURL>https://cdn3.onlyfans.com/dash/720/file.mp4</BaseURL><SegmentBase indexRange="100-200"><Initialization range="0-99"/></SegmentBase></Representation></AdaptationSet></Period></MPD>`;
  const ftyp = Uint8Array.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70]);
  let manifestGets = 0;
  let segmentCookie = "";
  let segmentRange = "";
  let licensePosts = 0;
  let licenseHref = "";
  const licenseHeadersSeen: { current: Headers | null } = { current: null };
  const logs: string[] = [];
  console.info = (...args: unknown[]) => {
    logs.push(args.map((item) => String(item)).join(" "));
  };
  const signedHeaders = {
    accept: "application/json, text/plain, */*",
    "app-token": "token",
    cookie: "sess=ok",
    sign: "firmado",
    time: "1",
    "user-agent": "ua",
    "x-bc": "huella",
    "user-id": "n",
    referer: "https://onlyfans.com/",
  };
  const fetchImpl = (async (input: unknown, init?: RequestInit) => {
    const href = String(input);
    const cookie = new Headers(init?.headers).get("cookie") ?? "";
    if (init?.method === "POST") {
      licensePosts += 1;
      licenseHref = href;
      licenseHeadersSeen.current = new Headers(init.headers);
      return new Response("license-ok", { status: 200, headers: { "content-type": "application/octet-stream" } });
    }
    if (href.includes("/dash/a.mpd")) {
      manifestGets += 1;
      if (href.startsWith("https://onlyfans.com/")) {
        assert.match(cookie, /sess=/);
        return new Response(null, { status: 302, headers: { location: "https://cdn3.onlyfans.com/dash/a.mpd?ok=1" } });
      }
      assert.equal(cookie.includes("sess"), false);
      assert.match(cookie, /CloudFront-Policy=/);
      return new Response(mpd, { status: 200, headers: { "content-type": "application/dash+xml" } });
    }
    if (href.includes("file.mp4")) {
      segmentCookie = cookie;
      segmentRange = new Headers(init?.headers).get("range") ?? "";
      return new Response(ftyp, { status: 206, headers: { "content-type": "video/mp4", "content-range": "bytes 0-99/400", "content-length": "8" } });
    }
    return new Response("no", { status: 404 });
  }) as typeof fetch;
  try {
    const first = openDrmManifest(detail, fetchImpl, async () => undefined, { creatorId: "u1fpdnp", mediaId: "24", sessionCookie: "sess=ok", origin: "https://fanlink.local" });
    const second = openDrmManifest(detail, fetchImpl, async () => undefined, { creatorId: "u1fpdnp", mediaId: "24", sessionCookie: "sess=ok", origin: "https://fanlink.local" });
    const [manifest] = await Promise.all([first, second]);
    assert.ok(manifest);
    assert.equal(manifestGets, 2);
    assert.match(describePlaylist(manifest), /lista=dash/);
    assert.match(describePlaylist(manifest), /key=widevine/);
    assert.match(describePlaylist(manifest), /formato=edef8ba9/);
    assert.equal(manifest.includes("cdn3.onlyfans.com"), false);
    assert.equal(manifest.includes("sek"), false);
    assert.match(manifest, /dashif:laurl/);
    assert.match(manifest, /variant=licencia/);
    assert.equal(manifest.includes("<laurl"), false);
    assert.equal(manifest.includes("license.pallycon.com"), false);
    assert.equal(manifest.includes("/api2/"), false);
    assert.equal(manifest.includes("cdn3.onlyfans.com"), false);
    const bases = [...manifest.matchAll(/<BaseURL>([^<]+)<\/BaseURL>/g)].map((item) => (item[1] ?? "").replace(/&amp;/g, "&"));
    assert.equal(bases.length >= 2, true);
    assert.ok(bases.every((item) => item.includes("variant=hls")));
    const target = new URL(bases[0] ?? "");
    const segment = await hlsMediaResponse({
      creatorId: target.searchParams.get("creatorId") ?? "",
      mediaId: target.searchParams.get("mediaId") ?? "",
      ticket: target.searchParams.get("k") ?? "",
      segment: target.searchParams.get("s") ?? "",
      base: target.searchParams.get("b"),
      path: target.searchParams.get("p"),
      range: "bytes=0-99",
    }, fetchImpl);
    assert.equal(segment.status, 206);
    assert.equal(segment.headers.get("content-range"), "bytes 0-99/400");
    assert.equal(segmentRange, "bytes=0-99");
    assert.equal(boundedSegmentRange("bytes=0-99"), "bytes=0-99");
    assert.equal(boundedSegmentRange("bytes=0-8000000"), "bytes=0-8000000");
    const segmentCap = SEGMENT_RANGE_BYTES - 1;
    assert.equal(boundedSegmentRange(`bytes=0-${SEGMENT_RANGE_BYTES + 100}`), `bytes=0-${segmentCap}`);
    const wide = await hlsMediaResponse({
      creatorId: target.searchParams.get("creatorId") ?? "",
      mediaId: target.searchParams.get("mediaId") ?? "",
      ticket: target.searchParams.get("k") ?? "",
      segment: target.searchParams.get("s") ?? "",
      range: `bytes=0-${SEGMENT_RANGE_BYTES + 100}`,
    }, fetchImpl);
    assert.equal(wide.status, 206);
    assert.equal(segmentRange, `bytes=0-${segmentCap}`);
    assert.equal(hasFtyp(new Uint8Array(await segment.arrayBuffer())), true);
    assert.match(segmentCookie, /CloudFront-Policy=/);
    assert.equal(segmentCookie.includes("sess"), false);
    const licenseUrl = new URL((/>(https?:\/\/[^<]*variant=licencia[^<]*)</.exec(manifest)?.[1] ?? "").replace(/&amp;/g, "&"));
    const challenge = Uint8Array.from([1, 2, 3, 4]);
    const license = await forwardDrmLicense({
      creatorId: licenseUrl.searchParams.get("creatorId") ?? "",
      mediaId: licenseUrl.searchParams.get("mediaId") ?? "",
      ticket: licenseUrl.searchParams.get("k") ?? "",
      segment: licenseUrl.searchParams.get("s") ?? "",
      body: challenge,
      contentType: "text/plain",
      sign: async () => signedHeaders,
    }, fetchImpl);
    assert.equal(license.status, 200);
    assert.equal(licensePosts, 1);
    assert.equal(licenseHref, "https://onlyfans.com/api2/v2/users/media/24/drm/?type=widevine");
    assert.equal(licenseHeadersSeen.current?.get("content-type"), "application/octet-stream");
    assert.equal(licenseHeadersSeen.current?.get("sign"), "firmado");
    assert.equal(licenseHeadersSeen.current?.get("time"), "1");
    assert.equal(licenseHeadersSeen.current?.get("app-token"), "token");
    assert.equal(licenseHeadersSeen.current?.get("x-bc"), "huella");
    assert.match(licenseHeadersSeen.current?.get("cookie") ?? "", /sess=/);
    assert.equal((licenseHeadersSeen.current?.get("cookie") ?? "").includes("CloudFront"), false);
    assert.match(logs.join("\n"), /tipo=licencia status=200 firma=si/);
    assert.equal(logs.some((line) => line.includes("firmado") || line.includes("sess") || line.includes("pallycon") || line.includes("onlyfans")), false);
    const messagePosts: string[] = [];
    const messageFetch = (async (input: unknown, init?: RequestInit) => {
      const href = String(input);
      if (init?.method === "POST") {
        messagePosts.push(href);
        return new Response("license-ok", { status: 200 });
      }
      if (href.includes("/dash/b.mpd")) return new Response(mpd, { status: 200, headers: { "content-type": "application/dash+xml" } });
      return new Response("no", { status: 404 });
    }) as typeof fetch;
    const messageManifest = await openDrmManifest({
      ...detail,
      id: 26,
      files: { full: { url: null }, drm: { manifest: { dash: "https://onlyfans.com/dash/b.mpd" }, signature: detail.files.drm.signature } },
    }, messageFetch, async () => undefined, { creatorId: "u1fpdnp", mediaId: "26", sessionCookie: "sess=ok", origin: "https://fanlink.local", drm: { kind: "message", id: "900" } });
    assert.ok(messageManifest);
    const messageLicense = new URL((/>(https?:\/\/[^<]*variant=licencia[^<]*)</.exec(messageManifest)?.[1] ?? "").replace(/&amp;/g, "&"));
    const messageSent = await forwardDrmLicense({
      creatorId: messageLicense.searchParams.get("creatorId") ?? "",
      mediaId: messageLicense.searchParams.get("mediaId") ?? "",
      ticket: messageLicense.searchParams.get("k") ?? "",
      segment: messageLicense.searchParams.get("s") ?? "",
      body: challenge,
      contentType: "application/octet-stream",
      sign: async () => signedHeaders,
    }, messageFetch);
    assert.equal(messageSent.status, 200);
    assert.deepEqual(messagePosts, ["https://onlyfans.com/api2/v2/users/media/26/drm/message/900?type=widevine"]);
    let unsignedPosts = 0;
    const unsigned = await forwardDrmLicense({
      creatorId: licenseUrl.searchParams.get("creatorId") ?? "",
      mediaId: licenseUrl.searchParams.get("mediaId") ?? "",
      ticket: licenseUrl.searchParams.get("k") ?? "",
      segment: licenseUrl.searchParams.get("s") ?? "",
      body: challenge,
      contentType: "application/octet-stream",
    }, (async () => {
      unsignedPosts += 1;
      return new Response("no", { status: 200 });
    }) as typeof fetch);
    assert.equal(unsigned.status, 502);
    assert.equal(unsignedPosts, 0);
    let redirectPosts = 0;
    const redirectOnly = await forwardDrmLicense({
      creatorId: licenseUrl.searchParams.get("creatorId") ?? "",
      mediaId: licenseUrl.searchParams.get("mediaId") ?? "",
      ticket: licenseUrl.searchParams.get("k") ?? "",
      segment: licenseUrl.searchParams.get("s") ?? "",
      body: challenge,
      contentType: "application/octet-stream",
      sign: async () => signedHeaders,
    }, (async () => {
      redirectPosts += 1;
      return new Response(null, { status: 302, headers: { location: "https://cdn3.onlyfans.com/steal" } });
    }) as typeof fetch);
    assert.equal(redirectOnly.status, 302);
    assert.equal(redirectPosts, 1);
    const fallbackPosts: Array<{ href: string; headers: Headers }> = [];
    const fallbackFetch = (async (input: unknown, init?: RequestInit) => {
      const href = String(input);
      if (init?.method === "POST") {
        fallbackPosts.push({ href, headers: new Headers(init.headers) });
        return new Response("license-ok", { status: 200 });
      }
      if (href.includes("/dash/c.mpd")) return new Response(mpd, { status: 200, headers: { "content-type": "application/dash+xml" } });
      return new Response("no", { status: 404 });
    }) as typeof fetch;
    const fallbackManifest = await openDrmManifest({
      ...detail,
      id: 27,
      files: { full: { url: null }, drm: { manifest: { dash: "https://onlyfans.com/dash/c.mpd" }, signature: detail.files.drm.signature } },
    }, fallbackFetch, async () => undefined, { creatorId: "u1fpdnp", mediaId: "sin-id", sessionCookie: "sess=ok", origin: "https://fanlink.local" });
    assert.ok(fallbackManifest);
    assert.match(fallbackManifest, /variant=licencia/);
    assert.equal(fallbackManifest.includes("license.pallycon.com"), false);
    const fallbackLicense = new URL((/>(https?:\/\/[^<]*variant=licencia[^<]*)</.exec(fallbackManifest)?.[1] ?? "").replace(/&amp;/g, "&"));
    const fallback = await forwardDrmLicense({
      creatorId: fallbackLicense.searchParams.get("creatorId") ?? "",
      mediaId: fallbackLicense.searchParams.get("mediaId") ?? "",
      ticket: fallbackLicense.searchParams.get("k") ?? "",
      segment: fallbackLicense.searchParams.get("s") ?? "",
      body: challenge,
      contentType: "application/octet-stream",
      sign: async () => signedHeaders,
    }, fallbackFetch);
    assert.equal(fallback.status, 200);
    assert.equal(fallbackPosts[0]?.href, "https://license.pallycon.com/ri/licenseManager.do");
    assert.equal(fallbackPosts[0]?.headers.get("sign"), null);
    assert.equal(fallbackPosts[0]?.headers.get("x-bc"), null);
    assert.equal(fallbackPosts[0]?.headers.get("cookie"), null);
    assert.equal(fallbackPosts[0]?.headers.get("content-type"), "application/octet-stream");
    delete process.env.FANLINK_ENABLE_DRM_LICENSE;
    assert.equal(drmLicenseEnabled(), false);
    assert.equal(JSON.parse(protectedVideoHold()).texto, "Vídeo protegido");
    const blocked = await forwardDrmLicense({
      creatorId: "u1fpdnp",
      mediaId: "24",
      ticket: "no",
      segment: "no",
      body: new Uint8Array(),
      contentType: "application/octet-stream",
    }, fetchImpl);
    assert.equal(blocked.status, 409);
    let evilGets = 0;
    const evilMpd = mpd.replace("https://cdn3.onlyfans.com/dash/720/file.mp4", "https://evil.example/dash/720/file.mp4");
    const evil = await openDrmManifestResult({
      ...detail,
      id: 28,
      files: { full: { url: null }, drm: { manifest: { dash: "https://cdn3.onlyfans.com/dash/evil.mpd" }, signature: detail.files.drm.signature } },
    }, (async (input: unknown) => {
      evilGets += 1;
      const href = String(input);
      if (href.includes("evil.example")) throw new Error("url cruda");
      if (href.includes("/dash/evil.mpd")) return new Response(evilMpd, { status: 200, headers: { "content-type": "application/dash+xml" } });
      return new Response("no", { status: 404 });
    }) as typeof fetch, async () => undefined, { creatorId: "u1fpdnp", mediaId: "28", sessionCookie: "sess=ok", origin: "https://fanlink.local" });
    assert.equal(evil.status, 502);
    assert.equal(evil.text, null);
    assert.equal(evilGets, 1);
    const otherHost = btoa("<WRMHEADER><DATA><LA_URL>https://evil.pallycon.com/ri/licenseManager.do</LA_URL></DATA></WRMHEADER>");
    const otherMpd = mpd.replace(pro, otherHost);
    let otherPosts = 0;
    const other = await openDrmManifestResult({
      ...detail,
      id: 29,
      files: { full: { url: null }, drm: { manifest: { dash: "https://cdn3.onlyfans.com/dash/other.mpd" }, signature: detail.files.drm.signature } },
    }, (async (input: unknown, init?: RequestInit) => {
      if (init?.method === "POST") otherPosts += 1;
      const href = String(input);
      if (href.includes("pallycon")) throw new Error("pallycon distinto");
      if (href.includes("/dash/other.mpd")) return new Response(otherMpd, { status: 200, headers: { "content-type": "application/dash+xml" } });
      return new Response("no", { status: 404 });
    }) as typeof fetch, async () => undefined, { creatorId: "u1fpdnp", mediaId: "otro", sessionCookie: "sess=ok", origin: "https://fanlink.local" });
    assert.equal(other.status, 502);
    assert.equal(other.text, null);
    assert.equal(otherPosts, 0);
    let waits = 0;
    await Promise.all([
      paceLicense("u1fpdnp", async () => { waits += 1; }),
      paceLicense("u1fpdnp", async () => { waits += 1; }),
    ]);
    assert.equal(waits, 2);
    assert.equal(licenseMethodStatus("GET", 0), 405);
    assert.equal(licenseMethodStatus("POST", LICENSE_BODY_MAX + 1), 413);
    assert.equal(licenseMethodStatus("POST", 32), null);
    assert.equal(await readBoundedPlaylist("http://cdn2.onlyfans.com/a.m3u8", async () => { throw new Error("http"); }), null);
  } finally {
    console.info = previousInfo;
    if (previous === undefined) delete process.env.FANLINK_ENABLE_DRM_LICENSE;
    else process.env.FANLINK_ENABLE_DRM_LICENSE = previous;
  }
});

test("un 416 del mp4 se reenvía", async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = (async () => new Response(null, { status: 416, headers: { "content-range": "bytes */8", "content-type": "video/mp4" } })) as typeof fetch;
  try {
    const served = await fetchVaultMedia("https://cdn2.onlyfans.com/files/big.mp4", { accept: "video/*", range: "bytes=9-10" }, true);
    assert.equal(served.status, 416);
    assert.equal("contentRange" in served ? served.contentRange : "", "bytes */8");
  } finally {
    globalThis.fetch = previous;
  }
});

function asSql(db: PGlite): ReadSql {
  return {
    async query<T>(text: string, params?: unknown[]): Promise<T[]> {
      const result = await db.query<T>(text, params);
      return result.rows;
    },
  };
}

function detailState(): StorageStateFile {
  return {
    cookies: [
      { name: "auth_id", value: "42", domain: ".onlyfans.com", path: "/", expires: -1, httpOnly: true, secure: true, sameSite: "Lax" },
      { name: "sess", value: "ok", domain: ".onlyfans.com", path: "/", expires: -1, httpOnly: true, secure: true, sameSite: "Lax" },
    ],
    origins: [{ origin: "https://onlyfans.com", localStorage: [{ name: "bcTokenSha", value: "huella" }] }],
  };
}

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
