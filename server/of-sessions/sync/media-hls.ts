import { playlistUrls, rewritePlaylist } from "./media-stream.ts";

export function isMasterPlaylist(body: string): boolean {
  return body.includes("#EXT-X-STREAM-INF");
}

/** Una master apunta a la variante. La variante apunta a los segmentos. */
export function rewriteHls(
  body: string,
  base: string,
  link: (absolute: string, kind: "playlist" | "segment") => string | null,
): string {
  const master = isMasterPlaylist(body);
  return rewritePlaylist(body, base, (absolute) => link(absolute, master || /\.m3u8(\?|$)/i.test(absolute) ? "playlist" : "segment"));
}

/** El segmento solo vale si la master o una variante listada en ella lo nombra. */
export function hlsUrlAllowed(
  masterBody: string,
  masterUrl: string,
  nested: Array<{ url: string; body: string }>,
  candidate: string,
): boolean {
  const listed = playlistUrls(masterBody, masterUrl);
  if (listed.includes(candidate)) return true;
  for (const entry of nested) {
    if (!listed.includes(entry.url)) continue;
    if (playlistUrls(entry.body, entry.url).includes(candidate)) return true;
  }
  return false;
}
