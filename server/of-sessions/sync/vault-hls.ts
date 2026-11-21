import { BROWSER_FINGERPRINT } from "../sessions/browser-factory.ts";
import { mediaHostAllowed } from "./history.ts";
import { drmManifestUrl, vaultFolderMark } from "./vault-model.ts";

const jars = new Map<string, { cookie: string; at: number }>();
const JAR_MS = 10 * 60_000;

/** La web pone la firma de CloudFront en cookies y pide el m3u8. Nosotros igual, en el proxy. */
export function cloudFrontCookie(row: Record<string, unknown>): string {
  const drm = nested(nested(row.files)?.drm);
  const signature = nested(drm?.signature);
  const source = nested(signature?.hls) ?? nested(signature?.dash) ?? signature;
  if (!source) return "";
  const parts: string[] = [];
  for (const name of ["CloudFront-Policy", "CloudFront-Signature", "CloudFront-Key-Pair-Id"]) {
    const value = source[name];
    if (typeof value === "string" && value.trim()) parts.push(`${name}=${value.trim()}`);
  }
  return parts.join("; ");
}

export function rememberHlsCookie(cookie: string): string {
  const key = Math.random().toString(16).slice(2, 10);
  jars.set(key, { cookie, at: Date.now() });
  return key;
}

export function hlsProxyPath(key: string, absolute: string): string {
  return `/api/vault-media?variant=hls&k=${encodeURIComponent(key)}&u=${Buffer.from(absolute).toString("base64url")}`;
}

export function rewriteHlsManifest(body: string, base: string, proxy: (absolute: string) => string | null): string {
  return body.split(/\r?\n/).map((line) => {
    if (line.startsWith("#")) {
      return line.replace(/URI="([^"]+)"/g, (_match, uri: string) => {
        try {
          const next = proxy(new URL(uri, base).toString());
          return next ? `URI="${next}"` : `URI="${uri}"`;
        } catch {
          return `URI="${uri}"`;
        }
      });
    }
    const trimmed = line.trim();
    if (!trimmed) return line;
    try {
      return proxy(new URL(trimmed, base).toString()) ?? "";
    } catch {
      return "";
    }
  }).filter((line) => line !== "").join("\n");
}

export const PLAYLIST_BYTE_LIMIT = 256 * 1024;

/** Un .ts o .m4s no se anuncia como el mp4 entero. Un .mpd no es un m3u8. */
export function hlsSegmentType(absolute: string, upstream: string): string {
  const path = absolute.split("?")[0]?.toLowerCase() ?? "";
  if (path.endsWith(".ts")) return "video/mp2t";
  if (path.endsWith(".mpd")) return "application/dash+xml";
  if (path.endsWith(".m4s") || path.endsWith(".cmfv") || path.endsWith(".cmfa")) return "video/iso.segment";
  if (upstream.startsWith("video/")) return upstream;
  if (path.endsWith(".mp4") || path.endsWith(".m4v") || path.endsWith(".mov")) return "video/mp4";
  return upstream || "application/octet-stream";
}

export async function readBoundedPlaylist(url: string, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  if (!mediaHostAllowed(url)) return null;
  try {
    const response = await fetchImpl(url, { redirect: "manual", signal: AbortSignal.timeout(8_000) });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return null;
    }
    const bytes = await readCapped(response, PLAYLIST_BYTE_LIMIT);
    if (!bytes) return null;
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

export async function fetchHlsUpstream(absolute: string, cookie: string, fetchImpl: typeof fetch, range: string | null, signal?: AbortSignal): Promise<{ status: number; bytes: Uint8Array | null; contentType: string }> {
  if (!hlsHostAllowed(absolute)) return { status: 404, bytes: null, contentType: "" };
  const headers: Record<string, string> = {
    accept: "*/*",
    referer: "https://onlyfans.com/",
    origin: "https://onlyfans.com",
    "user-agent": BROWSER_FINGERPRINT.userAgent,
  };
  if (cookie) headers.cookie = cookie;
  if (range) headers.range = range;
  const response = await fetchImpl(absolute, {
    headers,
    redirect: "manual",
    signal: signal ? AbortSignal.any([AbortSignal.timeout(20_000), signal]) : AbortSignal.timeout(20_000),
  });
  const type = (response.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  const path = absolute.split("?")[0]?.toLowerCase() ?? "";
  const limit = path.endsWith(".m3u8") || path.endsWith(".mpd") ? PLAYLIST_BYTE_LIMIT : 8_000_000;
  const bytes = await readCapped(response, limit);
  return { status: response.status, bytes, contentType: type };
}

export async function serveHlsTarget(key: string, encoded: string, fetchImpl: typeof fetch, range: string | null, signal?: AbortSignal): Promise<{ status: number; body: Uint8Array | null; contentType: string }> {
  const jar = jars.get(key);
  if (!jar || Date.now() - jar.at > JAR_MS) return { status: 404, body: null, contentType: "" };
  let absolute = "";
  try {
    absolute = Buffer.from(encoded, "base64url").toString("utf8");
  } catch {
    return { status: 404, body: null, contentType: "" };
  }
  if (!hlsHostAllowed(absolute)) return { status: 404, body: null, contentType: "" };
  const upstream = await fetchHlsUpstream(absolute, jar.cookie, fetchImpl, range, signal);
  if (!upstream.bytes) return { status: upstream.status || 404, body: null, contentType: "" };
  const text = new TextDecoder().decode(upstream.bytes);
  if (text.startsWith("#EXTM3U")) {
    const rewritten = rewriteHlsManifest(text, absolute, (next) => hlsHostAllowed(next) ? hlsProxyPath(key, next) : null);
    console.info(`[fanlink:vault] reproductor hls tipo=manifest firma=${jar.cookie ? "si" : "no"} origen=${vaultFolderMark(absolute)}`);
    return { status: 200, body: new TextEncoder().encode(rewritten), contentType: "application/vnd.apple.mpegurl" };
  }
  const path = absolute.split("?")[0]?.toLowerCase() ?? "";
  if (path.endsWith(".mpd") || text.trimStart().startsWith("<MPD")) {
    console.info(`[fanlink:vault] reproductor hls tipo=dash firma=${jar.cookie ? "si" : "no"}`);
    return { status: upstream.status, body: upstream.bytes, contentType: "application/dash+xml" };
  }
  console.info(`[fanlink:vault] reproductor hls tipo=segmento firma=${jar.cookie ? "si" : "no"}`);
  return { status: upstream.status, body: upstream.bytes, contentType: hlsSegmentType(absolute, upstream.contentType) };
}

export async function openHlsManifest(row: Record<string, unknown>, fetchImpl: typeof fetch, pause: () => Promise<void>): Promise<string | null> {
  const manifestUrl = drmManifestUrl(row);
  if (!manifestUrl) return null;
  const key = rememberHlsCookie(cloudFrontCookie(row));
  await pause();
  const opened = await serveHlsTarget(key, Buffer.from(manifestUrl).toString("base64url"), fetchImpl, null);
  if (!opened.body) return null;
  const text = new TextDecoder().decode(opened.body);
  return text.startsWith("#EXTM3U") ? text : null;
}

export async function hlsMediaResponse(key: string, encoded: string, range: string | null, fetchImpl: typeof fetch = fetch, signal?: AbortSignal): Promise<Response> {
  const served = await serveHlsTarget(key, encoded, fetchImpl, range, signal);
  if (!served.body) return new Response("Sin datos", { status: served.status || 404 });
  const bytes = served.body;
  const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return new Response(body, {
    status: served.status,
    headers: {
      "content-type": served.contentType || "application/octet-stream",
      "cache-control": "private, no-store",
      "accept-ranges": "bytes",
    },
  });
}

/** Forma real: convertedToVideo=no, sin mp4, manifiesto HLS y firma CloudFront. */
export async function playVaultHlsDetail(row: Record<string, unknown>, fetchImpl: typeof fetch, pause: () => Promise<void>): Promise<{ manifest: string; mediaPlaylist: string; segment: Uint8Array; contentType: string } | null> {
  const manifest = await openHlsManifest(row, fetchImpl, pause);
  if (!manifest) return null;
  let playlist = manifest;
  for (let hop = 0; hop < 4; hop += 1) {
    const line = playlist.split(/\r?\n/).find((item) => !item.startsWith("#") && item.includes("variant=hls"));
    if (!line) return null;
    const proxy = new URL(line.trim(), "https://fanlink.local");
    const next = await serveHlsTarget(proxy.searchParams.get("k") ?? "", proxy.searchParams.get("u") ?? "", fetchImpl, null);
    if (!next.body) return null;
    const text = new TextDecoder().decode(next.body);
    if (text.startsWith("#EXTM3U")) {
      playlist = text;
      continue;
    }
    return { manifest, mediaPlaylist: playlist, segment: next.body, contentType: next.contentType };
  }
  return null;
}

function hlsHostAllowed(raw: string): boolean {
  if (mediaHostAllowed(raw)) return true;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "https:" && parsed.hostname.toLowerCase().endsWith(".cloudfront.net");
  } catch {
    return false;
  }
}

async function readCapped(response: Response, limit: number): Promise<Uint8Array | null> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const step = await reader.read();
    if (step.done) break;
    total += step.value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(step.value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function nested(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}
