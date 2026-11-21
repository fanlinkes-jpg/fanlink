import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { choosePlayableVideo, parseVaultBundle, stampVaultList, vaultDetailRow, videoDetailHold, videoHoldText, videoShapeLine } from "../sync/vault-model.ts";
import { fetchSignedMediaDetail, vaultMediaDetailPath } from "../sync/of-chat-api.ts";
import { clearSignRulesCache } from "../sync/of-sign.ts";
import type { StorageStateFile } from "../sessions/storage-state.ts";
import { handleVaultMedia, headRange, noteVaultPlayRequest } from "../http/vault-http.ts";
import { loadFreshPreview } from "../sync/vault-thumbs.ts";
import { playbackUrl, reuseOrRefreshVideo, VIDEO_DETAIL_PAUSE_MS } from "../sync/vault-store.ts";
import type { ReadSql } from "../sync/store.ts";
import { clearVaultThumbs, fetchVaultMedia, getVaultThumb, hasFtyp, putVaultThumb, VIDEO_FETCH_TIMEOUT_MS, videoBytesAccepted, videoFollowUp } from "../sync/media-bytes.ts";
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
