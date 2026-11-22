import { BROWSER_FINGERPRINT } from "../sessions/browser-factory.ts";
import { nextMediaUrl } from "./history.ts";
import { boundedVideoRange } from "./media-bytes.ts";
import { isClientAbort } from "../http/vault-http.ts";
import { drmManifestUrl, vaultFolderMark } from "./vault-model.ts";

const JAR_MS = 10 * 60_000;
const PLAYLIST_BYTE_LIMIT = 256 * 1024;

type Ticket = {
  at: number;
  creatorId: string;
  mediaId: string;
  cdnCookie: string;
  sessionCookie: string;
  urls: Map<string, string>;
};

const tickets = new Map<string, Ticket>();

export type HlsScope = {
  creatorId: string;
  mediaId: string;
  sessionCookie: string;
};

type HlsBody = {
  status: number;
  contentType: string;
  contentRange: string | null;
  contentLength: number | null;
  body: Uint8Array | null;
  stream: ReadableStream<Uint8Array> | null;
};

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

export function sweepHlsTickets(now = Date.now()): void {
  for (const [id, ticket] of tickets) {
    if (now - ticket.at > JAR_MS) tickets.delete(id);
  }
}

function rememberTicket(scope: HlsScope, cdnCookie: string): string {
  sweepHlsTickets();
  const id = opaqueId();
  tickets.set(id, {
    at: Date.now(),
    creatorId: scope.creatorId,
    mediaId: scope.mediaId,
    cdnCookie,
    sessionCookie: scope.sessionCookie,
    urls: new Map(),
  });
  return id;
}

function ticketFor(id: string, creatorId: string, mediaId: string): Ticket | null {
  sweepHlsTickets();
  const ticket = tickets.get(id);
  if (!ticket || ticket.creatorId !== creatorId || ticket.mediaId !== mediaId) return null;
  return ticket;
}

function bindTarget(ticketId: string, absolute: string, variant: "hls" | "licencia"): string | null {
  const ticket = tickets.get(ticketId);
  if (!ticket || !hlsHostAllowed(absolute)) return null;
  const segment = opaqueId();
  ticket.urls.set(segment, absolute);
  const params = new URLSearchParams({
    variant,
    creatorId: ticket.creatorId,
    mediaId: ticket.mediaId,
    k: ticketId,
    s: segment,
  });
  return `/api/vault-media?${params.toString()}`;
}

export function rewriteHlsManifest(body: string, base: string, ticketId: string): string {
  return body.split(/\r?\n/).map((line) => {
    const license = line.startsWith("#EXT-X-KEY") || line.startsWith("#EXT-X-SESSION-KEY");
    if (line.startsWith("#")) {
      return line.replace(/URI="([^"]+)"/g, (_match, uri: string) => {
        try {
          const next = bindTarget(ticketId, new URL(uri, base).toString(), license ? "licencia" : "hls");
          return next ? `URI="${next}"` : "";
        } catch {
          return "";
        }
      }).replace(/URI=""/g, "");
    }
    const trimmed = line.trim();
    if (!trimmed) return line;
    try {
      return bindTarget(ticketId, new URL(trimmed, base).toString(), "hls") ?? "";
    } catch {
      return "";
    }
  }).filter((line) => line !== "").join("\n");
}

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
  if (!hlsHostAllowed(url)) return null;
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

export async function openHlsManifest(row: Record<string, unknown>, fetchImpl: typeof fetch, pause: () => Promise<void>, scope: HlsScope): Promise<string | null> {
  const manifestUrl = drmManifestUrl(row);
  if (!manifestUrl) return null;
  const ticketId = rememberTicket(scope, cloudFrontCookie(row));
  await pause();
  const opened = await serveHlsTarget(ticketId, manifestUrl, fetchImpl, null);
  if (!opened?.body) return null;
  const text = new TextDecoder().decode(opened.body);
  return text.startsWith("#EXTM3U") ? text : null;
}

export async function hlsMediaResponse(input: {
  creatorId: string;
  mediaId: string;
  ticket: string;
  segment: string;
  range: string | null;
  signal?: AbortSignal;
}, fetchImpl: typeof fetch = fetch): Promise<Response> {
  const ticket = ticketFor(input.ticket, input.creatorId, input.mediaId);
  const absolute = ticket?.urls.get(input.segment);
  if (!ticket || !absolute) return new Response("Sin datos", { status: 404 });
  const served = await serveHlsTarget(input.ticket, absolute, fetchImpl, input.range, input.signal);
  return hlsResponse(served);
}

export async function forwardDrmLicense(input: {
  creatorId: string;
  mediaId: string;
  ticket: string;
  segment: string;
  body: Uint8Array;
  contentType: string;
  signal?: AbortSignal;
}, fetchImpl: typeof fetch = fetch): Promise<Response> {
  const ticket = ticketFor(input.ticket, input.creatorId, input.mediaId);
  const absolute = ticket?.urls.get(input.segment);
  if (!ticket || !absolute || !hlsHostAllowed(absolute)) return new Response("Sin datos", { status: 404 });
  try {
    const response = await fetchFollowing(absolute, {
      method: "POST",
      headers: upstreamHeaders(absolute, ticket, input.contentType),
      body: input.body,
      signal: input.signal,
    }, fetchImpl);
    if (!response) return new Response("Sin datos", { status: 502 });
    console.info(`[fanlink:vault] reproductor hls tipo=licencia firma=${ticket.cdnCookie || ticket.sessionCookie ? "si" : "no"}`);
    const type = (response.headers.get("content-type") ?? "application/octet-stream").split(";")[0] ?? "application/octet-stream";
    return new Response(response.body, {
      status: response.status,
      headers: {
        "content-type": type,
        "cache-control": "private, no-store",
      },
    });
  } catch (error) {
    if (isClientAbort(error)) return new Response(null, { status: 499 });
    return new Response("Sin datos", { status: 502 });
  }
}

/** Forma real: convertedToVideo=no, drm=si, manifiesto y licencia. */
export async function playVaultHlsDetail(row: Record<string, unknown>, fetchImpl: typeof fetch, pause: () => Promise<void>, scope: HlsScope): Promise<{ manifest: string; mediaPlaylist: string; segment: Uint8Array; contentType: string } | null> {
  const manifest = await openHlsManifest(row, fetchImpl, pause, scope);
  if (!manifest) return null;
  let playlist = manifest;
  for (let hop = 0; hop < 4; hop += 1) {
    const line = playlist.split(/\r?\n/).find((item) => !item.startsWith("#") && item.includes("variant=hls"));
    if (!line) return null;
    const proxy = new URL(line.trim(), "https://fanlink.local");
    const served = await hlsMediaResponse({
      creatorId: proxy.searchParams.get("creatorId") ?? "",
      mediaId: proxy.searchParams.get("mediaId") ?? "",
      ticket: proxy.searchParams.get("k") ?? "",
      segment: proxy.searchParams.get("s") ?? "",
      range: null,
    }, fetchImpl);
    if (served.status === 404) return null;
    const type = served.headers.get("content-type") ?? "";
    if (type.includes("mpegurl") || type.includes("dash")) {
      playlist = await served.text();
      continue;
    }
    return { manifest, mediaPlaylist: playlist, segment: new Uint8Array(await served.arrayBuffer()), contentType: type };
  }
  return null;
}

async function serveHlsTarget(ticketId: string, absolute: string, fetchImpl: typeof fetch, range: string | null, signal?: AbortSignal): Promise<HlsBody | null> {
  const ticket = tickets.get(ticketId);
  if (!ticket || !hlsHostAllowed(absolute)) return null;
  const outboundRange = range ? boundedVideoRange(range) : null;
  let response: Response;
  try {
    const fetched = await fetchFollowing(absolute, {
      method: "GET",
      headers: upstreamHeaders(absolute, ticket, "*/*", outboundRange),
      signal,
    }, fetchImpl);
    if (!fetched) return { status: 502, contentType: "", contentRange: null, contentLength: null, body: null, stream: null };
    response = fetched;
  } catch (error) {
    if (isClientAbort(error)) return { status: 499, contentType: "", contentRange: null, contentLength: null, body: null, stream: null };
    return { status: 0, contentType: "", contentRange: null, contentLength: null, body: null, stream: null };
  }
  const path = absolute.split("?")[0]?.toLowerCase() ?? "";
  const playlist = path.endsWith(".m3u8") || path.endsWith(".mpd");
  if (playlist) {
    const bytes = await readCapped(response, PLAYLIST_BYTE_LIMIT);
    if (!bytes) return null;
    const text = new TextDecoder().decode(bytes);
    if (text.startsWith("#EXTM3U")) {
      const rewritten = rewriteHlsManifest(text, absolute, ticketId);
      console.info(`[fanlink:vault] reproductor hls tipo=manifest firma=${ticket.cdnCookie ? "si" : "no"} origen=${vaultFolderMark(absolute)}`);
      return { status: 200, contentType: "application/vnd.apple.mpegurl", contentRange: null, contentLength: null, body: new TextEncoder().encode(rewritten), stream: null };
    }
    if (path.endsWith(".mpd") || text.trimStart().startsWith("<MPD")) {
      console.info(`[fanlink:vault] reproductor hls tipo=dash firma=${ticket.cdnCookie ? "si" : "no"}`);
      return { status: response.status, contentType: "application/dash+xml", contentRange: null, contentLength: null, body: bytes, stream: null };
    }
  }
  console.info(`[fanlink:vault] reproductor hls tipo=segmento firma=${ticket.cdnCookie ? "si" : "no"}`);
  const lengthHeader = response.headers.get("content-length");
  const length = lengthHeader == null ? null : Number(lengthHeader);
  return {
    status: response.status,
    contentType: hlsSegmentType(absolute, (response.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? ""),
    contentRange: response.headers.get("content-range"),
    contentLength: length != null && Number.isFinite(length) ? length : null,
    body: null,
    stream: response.body,
  };
}

function hlsResponse(served: HlsBody | null): Response {
  if (!served) return new Response("Sin datos", { status: 404 });
  if (served.status === 499) return new Response(null, { status: 499 });
  const headers = new Headers({
    "content-type": served.contentType || "application/octet-stream",
    "cache-control": "private, no-store",
    "accept-ranges": "bytes",
  });
  if (served.contentRange) headers.set("content-range", served.contentRange);
  if (served.contentLength != null) headers.set("content-length", String(served.contentLength));
  if (served.stream) return new Response(served.stream, { status: served.status, headers });
  if (!served.body) return new Response("Sin datos", { status: served.status || 404 });
  const bytes = served.body;
  const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return new Response(body, { status: served.status, headers });
}

function upstreamHeaders(absolute: string, ticket: Ticket, accept: string, range?: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    accept,
    referer: "https://onlyfans.com/",
    origin: "https://onlyfans.com",
    "user-agent": BROWSER_FINGERPRINT.userAgent,
  };
  const cookie = cookieFor(absolute, ticket);
  if (cookie) headers.cookie = cookie;
  if (range) headers.range = range;
  return headers;
}

function cookieFor(absolute: string, ticket: Ticket): string {
  try {
    const host = new URL(absolute).hostname.toLowerCase();
    if (host === "onlyfans.com" || host === "www.onlyfans.com") return ticket.sessionCookie;
  } catch {
    return "";
  }
  return ticket.cdnCookie;
}

async function fetchFollowing(absolute: string, init: { method: string; headers: Record<string, string>; body?: Uint8Array; signal?: AbortSignal }, fetchImpl: typeof fetch): Promise<Response | null> {
  const signal = init.signal ? AbortSignal.any([AbortSignal.timeout(20_000), init.signal]) : AbortSignal.timeout(20_000);
  const body = init.body ? init.body.buffer.slice(init.body.byteOffset, init.body.byteOffset + init.body.byteLength) as ArrayBuffer : undefined;
  let current = absolute;
  let response = await fetchImpl(current, {
    method: init.method,
    headers: init.headers,
    body,
    redirect: "manual",
    signal,
  });
  if (response.status >= 300 && response.status < 400) {
    const next = nextMediaUrl(current, response.headers.get("location"));
    await response.body?.cancel().catch(() => undefined);
    if (!next) return null;
    response = await fetchImpl(next, {
      method: init.method,
      headers: init.headers,
      body,
      redirect: "manual",
      signal,
    });
  }
  return response;
}

function hlsHostAllowed(raw: string): boolean {
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
    const host = parsed.hostname.toLowerCase();
    if (host === "onlyfans.com" || host.endsWith(".onlyfans.com") || host.endsWith(".cloudfront.net")) {
      const path = parsed.pathname.toLowerCase();
      return !path.includes("/api2/") || host === "onlyfans.com" || host === "www.onlyfans.com";
    }
    return false;
  } catch {
    return false;
  }
}

async function readCapped(response: Response, limit: number): Promise<Uint8Array | null> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
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
  } catch (error) {
    if (isClientAbort(error)) return null;
    throw error;
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function opaqueId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 16);
}

function nested(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}
