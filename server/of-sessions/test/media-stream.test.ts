import assert from "node:assert/strict";
import { test } from "node:test";
import { parseChatMessages } from "../sync/chats.ts";
import { mediaPlay } from "../sync/media-play.ts";
import { isHlsUrl, openMediaStream, playlistUrls, rewritePlaylist } from "../sync/media-stream.ts";

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
