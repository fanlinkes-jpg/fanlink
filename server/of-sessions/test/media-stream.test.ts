import assert from "node:assert/strict";
import { test } from "node:test";
import { parseChatMessages } from "../sync/chats.ts";
import { mediaPlay } from "../sync/media-play.ts";
import { MEDIA_MAX_BYTES, PLAYLIST_CACHE_MAX_CHARS, acceptMediaRange, capBody, clearPlaylistCache, fetchUpstream, isHlsUrl, loadPlaylistCached, openMediaStream, playlistUrls, rewritePlaylist } from "../sync/media-stream.ts";

const now = Date.parse("2026-11-06T12:00:00.000Z");

test("el proxy reenvía Range, rechaza otro host y una URL caducada", async () => {
  let seenRange: string | null = null;
  const ranged = await openMediaStream("https://cdn2.onlyfans.com/v.mp4", "bytes=0-1", async (_url, headers) => {
    seenRange = headers.get("range");
    return {
      status: 206,
      location: null,
      headers: new Headers({ "content-type": "video/mp4", "content-range": "bytes 0-1/6", "content-length": "2" }),
      body: null,
    };
  }, now);
  assert.equal(seenRange, "bytes=0-1");
  assert.equal(ranged.ok, true);
  if (ranged.ok) {
    assert.equal(ranged.status, 206);
    assert.equal(ranged.headers["content-range"], "bytes 0-1/6");
    assert.equal(ranged.headers["cache-control"], "private, no-store");
  }

  let called = false;
  const foreign = await openMediaStream("https://evil.example/v.mp4", null, async () => {
    called = true;
    return { status: 200, location: null, headers: new Headers(), body: null };
  }, now);
  assert.equal(foreign.ok, false);
  if (!foreign.ok) assert.equal(foreign.reason, "host");
  assert.equal(called, false);

  const expired = await openMediaStream("https://cdn2.onlyfans.com/v.mp4?Expires=1", "bytes=0-1", async () => {
    called = true;
    return { status: 200, location: null, headers: new Headers(), body: null };
  }, now);
  assert.equal(expired.ok, false);
  if (!expired.ok) assert.equal(expired.reason, "caducado");
  assert.equal(called, false);
});

test("un PPV no comprado no se reproduce y el propio usa files.full", () => {
  const messages = parseChatMessages({
    list: [{
      id: 9,
      text: "set",
      createdAt: "2026-11-06T12:00:00.000Z",
      fromUser: { id: 42 },
      price: 5,
      isOpened: false,
      canPurchase: true,
      media: [{
        type: "video",
        canView: true,
        files: {
          thumb: { url: "https://cdn2.onlyfans.com/t.jpg" },
          full: { url: "https://cdn2.onlyfans.com/v.mp4" },
        },
      }],
    }],
  }, "7", "7", "42");
  const own = messages[0]?.media?.[0];
  assert.ok(own);
  assert.equal(own?.full, "https://cdn2.onlyfans.com/v.mp4");
  assert.equal(mediaPlay(own!, false, now).play, true);
  const ownLocked = mediaPlay({ ...own!, locked: true, paid: false }, false, now);
  assert.equal(ownLocked.play, true);
  const fanView = parseChatMessages({
    list: [{
      id: 10,
      text: "fan",
      createdAt: "2026-11-06T12:00:00.000Z",
      fromUser: { id: 7 },
      media: [{
        type: "video",
        canView: true,
        isLocked: true,
        files: { full: { url: "https://cdn2.onlyfans.com/fan.mp4" } },
      }],
    }],
  }, "7", "7", "42");
  assert.equal(fanView[0]?.media?.[0]?.locked, false);
  assert.equal(mediaPlay(fanView[0]!.media![0]!, true, now).play, true);
  const fanHidden = parseChatMessages({
    list: [{
      id: 11,
      text: "oculto",
      createdAt: "2026-11-06T12:00:00.000Z",
      fromUser: { id: 7 },
      price: 5,
      isOpened: false,
      media: [{ type: "video", canView: false, files: { full: { url: "https://cdn2.onlyfans.com/no.mp4" } } }],
    }],
  }, "7", "7", "42");
  assert.equal(fanHidden[0]?.media?.[0]?.locked, true);
  const hiddenPlay = mediaPlay(fanHidden[0]!.media![0]!, true, now);
  assert.equal(hiddenPlay.play, false);
  if (!hiddenPlay.play) assert.equal(hiddenPlay.notice, "Vídeo bloqueado");
  const blocked = mediaPlay({ ...own!, paid: false, locked: true }, true, now);
  assert.equal(blocked.play, false);
  if (!blocked.play) assert.equal(blocked.notice, "Vídeo bloqueado");
  const missing = mediaPlay({ ...own!, full: null }, false, now);
  assert.equal(missing.play, false);
  if (!missing.play) assert.equal(missing.notice, "Enlace caducado, recarga el chat");
  const expired = mediaPlay({ ...own!, full: "https://cdn2.onlyfans.com/v.mp4?Expires=1" }, false, now);
  assert.equal(expired.play, false);
  if (!expired.play) assert.equal(expired.notice, "Enlace caducado, recarga el chat");
});

test("el proxy solo acepta un bytes=N-M dentro del tope", async () => {
  const rejected = ["bytes=0-1,2-3", "bytes=-5", "bytes=5-1", `bytes=0-${MEDIA_MAX_BYTES}`, "bytes=1-0", "foo", "bytes=0-1, 2-3"];
  for (const header of rejected) {
    let called = false;
    const result = await openMediaStream("https://cdn2.onlyfans.com/v.mp4", header, async () => {
      called = true;
      return { status: 200, location: null, headers: new Headers(), body: null };
    }, now);
    assert.equal(called, false, header);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, 416);
      assert.equal(result.reason, "rango");
    }
    assert.equal(acceptMediaRange(header).ok, false);
  }

  let seen: string | null = null;
  const openEnded = await openMediaStream("https://cdn2.onlyfans.com/v.mp4", "bytes=10-", async (_url, headers) => {
    seen = headers.get("range");
    return { status: 206, location: null, headers: new Headers({ "content-length": "4" }), body: null };
  }, now);
  assert.equal(seen, `bytes=10-${10 + MEDIA_MAX_BYTES - 1}`);
  assert.equal(openEnded.ok, true);

  const huge = await openMediaStream("https://cdn2.onlyfans.com/v.mp4", "bytes=0-1", async () => ({
    status: 200,
    location: null,
    headers: new Headers({ "content-length": String(MEDIA_MAX_BYTES + 1) }),
    body: null,
  }), now);
  assert.equal(huge.ok, false);
  if (!huge.ok) assert.equal(huge.status, 416);
});

test("el fetch del proxy corta por tiempo y por bytes", async () => {
  const hung = await fetchUpstream("https://cdn2.onlyfans.com/v.mp4", new Headers(), (_url, init) => new Promise((_resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("tarde")), 5_000);
    init?.signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(init.signal?.reason ?? new Error("abort"));
    });
  }), 30);
  assert.equal(hung.status, 0);

  const oversized = await fetchUpstream("https://cdn2.onlyfans.com/v.mp4", new Headers(), async () => new Response(new Uint8Array([1, 2, 3, 4]), {
    status: 200,
    headers: { "content-length": "9" },
  }), 1_000, 4);
  assert.equal(oversized.status, 416);
  assert.equal(oversized.body, null);

  const stream = capBody(new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3]));
      controller.close();
    },
  }), 2);
  await assert.rejects(new Response(stream).arrayBuffer());
});

test("el cuerpo lento no lo corta el tiempo de las cabeceras, y el silencio sí", async () => {
  const slow = await fetchUpstream("https://cdn2.onlyfans.com/v.mp4", new Headers(), async () => new Response(new ReadableStream({
    async start(controller) {
      await new Promise((resolve) => setTimeout(resolve, 40));
      controller.enqueue(new Uint8Array([7]));
      controller.close();
    },
  }), { status: 200, headers: { "content-length": "1" } }), 10, 100, 200);
  assert.equal(slow.status, 200);
  const bytes = await new Response(slow.body ?? undefined).arrayBuffer();
  assert.equal(bytes.byteLength, 1);

  const quiet = capBody(new ReadableStream({
    async pull(controller) {
      await new Promise((resolve) => setTimeout(resolve, 80));
      controller.enqueue(new Uint8Array([1]));
    },
  }), 10, 20);
  await assert.rejects(new Response(quiet ?? undefined).arrayBuffer());
});

test("la caché de playlists tiene tope de entradas y de tamaño", async () => {
  clearPlaylistCache();
  await loadPlaylistCached("a", 1, async () => "a", 10_000, 2);
  await loadPlaylistCached("b", 2, async () => "b", 10_000, 2);
  await loadPlaylistCached("c", 3, async () => "c", 10_000, 2);
  let again = 0;
  await loadPlaylistCached("a", 4, async () => {
    again += 1;
    return "a";
  }, 10_000, 2);
  assert.equal(again, 1);
  clearPlaylistCache();
  let hugeLoads = 0;
  const huge = "x".repeat(PLAYLIST_CACHE_MAX_CHARS + 1);
  const loadHuge = async () => {
    hugeLoads += 1;
    return huge;
  };
  await loadPlaylistCached("grande", 1, loadHuge);
  await loadPlaylistCached("grande", 2, loadHuge);
  assert.equal(hugeLoads, 2);
  clearPlaylistCache();
});

test("la playlist HLS no se vuelve a pedir dentro del plazo", async () => {
  clearPlaylistCache();
  let calls = 0;
  const load = async () => {
    calls += 1;
    return "#EXTM3U\n";
  };
  assert.equal(await loadPlaylistCached("lista", 1_000, load, 10_000), "#EXTM3U\n");
  assert.equal(await loadPlaylistCached("lista", 5_000, load, 10_000), "#EXTM3U\n");
  assert.equal(calls, 1);
  assert.equal(await loadPlaylistCached("lista", 20_000, load, 10_000), "#EXTM3U\n");
  assert.equal(calls, 2);
  clearPlaylistCache();
});

test("una lista HLS se reescribe hacia el mismo proxy", () => {
  const base = "https://cdn2.onlyfans.com/hls/main.m3u8";
  const body = "#EXTM3U\n#EXT-X-MAP:URI=\"init.mp4\"\nseg-1.m4s\n";
  const urls = playlistUrls(body, base);
  assert.deepEqual(urls, [
    "https://cdn2.onlyfans.com/hls/init.mp4",
    "https://cdn2.onlyfans.com/hls/seg-1.m4s",
  ]);
  const rewritten = rewritePlaylist(body, base, (absolute) => `/api/chat-media?u=${encodeURIComponent(absolute)}`);
  assert.match(rewritten, /\/api\/chat-media\?u=/);
  assert.equal(rewritten.includes("evil.example"), false);
  assert.equal(isHlsUrl(base), true);
  assert.equal(isHlsUrl("https://cdn2.onlyfans.com/v.mp4"), false);
});
