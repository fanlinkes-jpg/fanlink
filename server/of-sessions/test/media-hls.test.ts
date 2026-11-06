import assert from "node:assert/strict";
import { test } from "node:test";
import { hlsUrlAllowed, isMasterPlaylist, rewriteHls } from "../sync/media-hls.ts";

test("una master se reescribe hacia la variante y la variante hacia el segmento", () => {
  const master = "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000\nvariant.m3u8\n";
  const base = "https://cdn2.onlyfans.com/hls/master.m3u8";
  assert.equal(isMasterPlaylist(master), true);
  const rewritten = rewriteHls(master, base, (absolute, kind) => `/api/chat-media?variant=${kind}&u=${encodeURIComponent(absolute)}`);
  assert.match(rewritten, /variant=playlist/);
  assert.match(rewritten, /variant\.m3u8/);
  const media = "#EXTM3U\n#EXTINF:4,\nseg-1.m4s\n";
  const variantUrl = "https://cdn2.onlyfans.com/hls/variant.m3u8";
  const segments = rewriteHls(media, variantUrl, (absolute, kind) => `/api/chat-media?variant=${kind}&u=${encodeURIComponent(absolute)}`);
  assert.match(segments, /variant=segment/);
  assert.equal(segments.includes("variant=playlist"), false);
  assert.equal(hlsUrlAllowed(master, base, [{ url: variantUrl, body: media }], "https://cdn2.onlyfans.com/hls/seg-1.m4s"), true);
  assert.equal(hlsUrlAllowed(master, base, [{ url: variantUrl, body: media }], "https://evil.example/x"), false);
});
