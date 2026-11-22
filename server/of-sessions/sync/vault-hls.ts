import { BROWSER_FINGERPRINT } from "../sessions/browser-factory.ts";
import { nextMediaUrl } from "./history.ts";
import { boundedVideoRange } from "./media-bytes.ts";
import { isClientAbort } from "../http/vault-http.ts";
import { drmManifestUrl, drmPlaybackChoice, vaultFolderMark } from "./vault-model.ts";

const JAR_MS = 10 * 60_000;
const PLAYLIST_BYTE_LIMIT = 256 * 1024;
export const LICENSE_BODY_MAX = 256 * 1024;

export function drmLicenseEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.FANLINK_ENABLE_DRM_LICENSE === "true";
}

export function protectedVideoHold(): string {
  return JSON.stringify({ texto: "Vídeo protegido", abrir: false });
}

const licenseQueue = new Map<string, Promise<void>>();

/** Una licencia por cuenta, con la misma pausa que el detalle. */
export async function paceLicense(creatorId: string, pause: (ms: number) => Promise<void>, waitMs = 800): Promise<void> {
  const previous = licenseQueue.get(creatorId) ?? Promise.resolve();
  let release: () => void = () => undefined;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const done = previous.then(async () => {
    await pause(waitMs);
  }).finally(release);
  licenseQueue.set(creatorId, done);
  await done;
  if (licenseQueue.get(creatorId) === done) licenseQueue.delete(creatorId);
}

type Ticket = {
  at: number;
  creatorId: string;
  mediaId: string;
  origin: string;
  cdnCookie: string;
  sessionCookie: string;
  urls: Map<string, string>;
  bases: Map<string, string>;
};

const tickets = new Map<string, Ticket>();

export type HlsScope = {
  creatorId: string;
  mediaId: string;
  sessionCookie: string;
  origin: string;
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
export function cloudFrontCookie(row: Record<string, unknown>, kind: "hls" | "dash" = "hls"): string {
  const drm = nested(nested(row.files)?.drm);
  const signature = nested(drm?.signature);
  const source = nested(signature?.[kind]) ?? nested(signature?.hls) ?? nested(signature?.dash) ?? signature;
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
    origin: scope.origin.replace(/\/$/, ""),
    cdnCookie,
    sessionCookie: scope.sessionCookie,
    urls: new Map(),
    bases: new Map(),
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
  const path = `/api/vault-media?${params.toString()}`;
  return ticket.origin ? `${ticket.origin}${path}` : path;
}

function bindDashFile(ticketId: string, absolute: string): string | null {
  const ticket = tickets.get(ticketId);
  if (!ticket || !hlsHostAllowed(absolute.split("$")[0] || absolute)) return null;
  const slash = absolute.lastIndexOf("/");
  if (slash < 0) return null;
  const dir = absolute.slice(0, slash + 1);
  const file = absolute.slice(slash + 1);
  if (!file || file.includes("..")) return null;
  let baseId = "";
  for (const [id, value] of ticket.bases) {
    if (value === dir) baseId = id;
  }
  if (!baseId) {
    baseId = opaqueId();
    ticket.bases.set(baseId, dir);
  }
  const query = [
    "variant=hls",
    `creatorId=${encodeURIComponent(ticket.creatorId)}`,
    `mediaId=${encodeURIComponent(ticket.mediaId)}`,
    `k=${ticketId}`,
    `b=${baseId}`,
    `p=${file}`,
  ].join("&");
  const path = `/api/vault-media?${query}`;
  return ticket.origin ? `${ticket.origin}${path}` : path;
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

export function rewriteMpd(body: string, base: string, ticketId: string): string {
  const baseUrl = /<BaseURL>([^<]+)<\/BaseURL>/i.exec(body)?.[1]?.trim();
  const root = baseUrl ? new URL(baseUrl, base).toString() : base;
  const swap = (raw: string, license: boolean) => {
    try {
      const absolute = new URL(raw, root).toString();
      if (absolute.includes("$")) return bindDashFile(ticketId, absolute) ?? raw;
      return bindTarget(ticketId, absolute, license ? "licencia" : "hls") ?? raw;
    } catch {
      return raw;
    }
  };
  return body
    .replace(/<BaseURL>[^<]*<\/BaseURL>/gi, "<BaseURL></BaseURL>")
    .replace(/<(?:[A-Za-z0-9]+:)?Laurl[^>]*>([^<]+)<\/(?:[A-Za-z0-9]+:)?Laurl>/g, (line, url: string) => line.replace(url, swap(url.trim(), true)))
    .replace(/\b(media|initialization|sourceURL)="([^"]+)"/g, (line, _name: string, url: string) => line.replace(url, swap(url, false)));
}

/** Forma de la lista, sin URLs ni firmas. */
export function describePlaylist(body: string): string {
  const rewritten = (body.match(/[?&]k=/g) ?? []).length;
  if (body.includes("<MPD") || body.trimStart().startsWith("<")) {
    const variants = (body.match(/<Representation\b/g) ?? []).length;
    const segments = (body.match(/<SegmentTemplate\b/g) ?? []).length + (body.match(/<S\b/g) ?? []).length;
    const widevine = body.includes("edef8ba9-79d6-4ace-a3c8-27dcd51d21ed");
    return `lista=dash variantes=${variants} segmentos=${segments} key=${widevine ? "widevine" : "no"} formato=${widevine ? "edef8ba9" : "no"} reescritas=${rewritten}`;
  }
  const lines = body.split(/\r?\n/);
  const variantTags = lines.filter((line) => line.startsWith("#EXT-X-STREAM-INF")).length;
  const mediaLines = lines.filter((line) => {
    const item = line.trim();
    return Boolean(item) && !item.startsWith("#");
  }).length;
  const keyLine = lines.find((line) => line.startsWith("#EXT-X-KEY")) ?? "";
  const method = /METHOD=([^,\s"]+)/.exec(keyLine)?.[1] ?? "no";
  const formatRaw = /KEYFORMAT="([^"]+)"/.exec(keyLine)?.[1] ?? "";
  const format = formatRaw.includes("edef8ba9") ? "edef8ba9" : formatRaw ? "otro" : "no";
  const master = variantTags > 0;
  return `lista=${master ? "master" : "media"} variantes=${master ? mediaLines : 0} segmentos=${master ? 0 : mediaLines} key=${method} formato=${format} reescritas=${rewritten}`;
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
  return openPlaybackManifest(row, manifestUrl, "hls", fetchImpl, pause, scope);
}

const openingManifests = new Map<string, Promise<string | null>>();

export async function openDrmManifest(row: Record<string, unknown>, fetchImpl: typeof fetch, pause: () => Promise<void>, scope: HlsScope): Promise<string | null> {
  const choice = drmPlaybackChoice(row);
  if (!choice) return null;
  const key = `${scope.creatorId}\n${scope.mediaId}\n${choice.kind}`;
  const pending = openingManifests.get(key);
  if (pending) return pending;
  const promise = openPlaybackManifest(row, choice.url, choice.kind, fetchImpl, pause, scope).finally(() => {
    if (openingManifests.get(key) === promise) openingManifests.delete(key);
  });
  openingManifests.set(key, promise);
  return promise;
}

async function openPlaybackManifest(row: Record<string, unknown>, manifestUrl: string, kind: "hls" | "dash", fetchImpl: typeof fetch, pause: () => Promise<void>, scope: HlsScope): Promise<string | null> {
  const ticketId = rememberTicket(scope, cloudFrontCookie(row, kind));
  await pause();
  const opened = await serveHlsTarget(ticketId, manifestUrl, fetchImpl, null);
  if (!opened?.body) return null;
  const text = new TextDecoder().decode(opened.body);
  if (kind === "dash") return text.includes("<MPD") || text.includes("vault-media") ? text : null;
  return text.startsWith("#EXTM3U") ? text : null;
}

export async function hlsMediaResponse(input: {
  creatorId: string;
  mediaId: string;
  ticket: string;
  segment: string;
  base?: string | null;
  path?: string | null;
  range: string | null;
  signal?: AbortSignal;
}, fetchImpl: typeof fetch = fetch): Promise<Response> {
  const ticket = ticketFor(input.ticket, input.creatorId, input.mediaId);
  const absolute = resolveTicketTarget(ticket, input.segment, input.base ?? null, input.path ?? null);
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
  sign?: (pathWithQuery: string) => Promise<Record<string, string> | null>;
}, fetchImpl: typeof fetch = fetch): Promise<Response> {
  if (!drmLicenseEnabled()) return new Response(protectedVideoHold(), { status: 409, headers: { "content-type": "application/json; charset=utf-8" } });
  const ticket = ticketFor(input.ticket, input.creatorId, input.mediaId);
  const absolute = ticket?.urls.get(input.segment);
  if (!ticket || !absolute || !hlsHostAllowed(absolute)) return new Response("Sin datos", { status: 404 });
  try {
    const headers = await licenseHeaders(absolute, ticket, input.contentType, input.sign);
    const response = await fetchFollowing(absolute, {
      method: "POST",
      headers,
      body: input.body,
      signal: input.signal,
    }, fetchImpl, ticket);
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
    }, fetchImpl, ticket);
    if (!fetched) return { status: 502, contentType: "", contentRange: null, contentLength: null, body: null, stream: null };
    response = fetched;
  } catch (error) {
    if (signal?.aborted && isClientAbort(error)) return { status: 499, contentType: "", contentRange: null, contentLength: null, body: null, stream: null };
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
      console.info(`[fanlink:vault] reproductor hls tipo=manifest ${describePlaylist(rewritten)} firma=${ticket.cdnCookie ? "si" : "no"} origen=${vaultFolderMark(absolute)}`);
      return { status: 200, contentType: "application/vnd.apple.mpegurl", contentRange: null, contentLength: null, body: new TextEncoder().encode(rewritten), stream: null };
    }
    if (path.endsWith(".mpd") || text.trimStart().startsWith("<MPD") || text.includes("<MPD")) {
      const rewritten = rewriteMpd(text, absolute, ticketId);
      console.info(`[fanlink:vault] reproductor hls tipo=dash ${describePlaylist(rewritten)} firma=${ticket.cdnCookie ? "si" : "no"} origen=${vaultFolderMark(absolute)}`);
      return { status: 200, contentType: "application/dash+xml", contentRange: null, contentLength: null, body: new TextEncoder().encode(rewritten), stream: null };
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

async function licenseHeaders(absolute: string, ticket: Ticket, contentType: string, sign?: (pathWithQuery: string) => Promise<Record<string, string> | null>): Promise<Record<string, string>> {
  const url = new URL(absolute);
  if (url.pathname.includes("/api2/") && sign) {
    const signed = await sign(`${url.pathname}${url.search}`);
    if (signed) return { ...signed, "content-type": contentType };
  }
  const headers = upstreamHeaders(absolute, ticket, contentType);
  headers["content-type"] = contentType;
  return headers;
}

async function fetchFollowing(absolute: string, init: { method: string; headers: Record<string, string>; body?: Uint8Array; signal?: AbortSignal }, fetchImpl: typeof fetch, ticket: Ticket): Promise<Response | null> {
  const signal = init.signal ? AbortSignal.any([AbortSignal.timeout(20_000), init.signal]) : AbortSignal.timeout(20_000);
  const body = init.body ? init.body.buffer.slice(init.body.byteOffset, init.body.byteOffset + init.body.byteLength) as ArrayBuffer : undefined;
  let response = await fetchImpl(absolute, {
    method: init.method,
    headers: init.headers,
    body,
    redirect: "manual",
    signal,
  });
  if (init.method === "POST" || response.status < 300 || response.status >= 400) return response;
  const next = nextMediaUrl(absolute, response.headers.get("location"));
  await response.body?.cancel().catch(() => undefined);
  if (!next) return null;
  response = await fetchImpl(next, {
    method: "GET",
    headers: upstreamHeaders(next, ticket, init.headers.accept ?? "*/*", init.headers.range),
    redirect: "manual",
    signal,
  });
  return response;
}

function hlsHostAllowed(raw: string): boolean {
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:") return false;
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

function resolveTicketTarget(ticket: Ticket | null, segment: string, base: string | null, path: string | null): string | null {
  if (!ticket) return null;
  if (segment && ticket.urls.has(segment)) return ticket.urls.get(segment) ?? null;
  if (!base || !path) return null;
  if (path.includes("..") || path.includes("/") || path.includes("\\") || path.includes("$") || path.includes("?")) return null;
  const dir = ticket.bases.get(base);
  if (!dir) return null;
  try {
    return new URL(path, dir).toString();
  } catch {
    return null;
  }
}

function opaqueId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 16);
}

function nested(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}
