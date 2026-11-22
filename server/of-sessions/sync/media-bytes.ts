import { browserVideoType, videoContainer } from "./vault-model.ts";
import { sessionForApi } from "./of-chat-api.ts";
import { mediaHostAllowed, nextMediaUrl } from "./history.ts";
import { BROWSER_FINGERPRINT } from "../sessions/browser-factory.ts";

/** La descarga de un vídeo no espera más que esto a que el CDN conteste. */
export const VIDEO_FETCH_TIMEOUT_MS = 20_000;

/**
 * Cada petición de vídeo baja como mucho 2 MiB.
 * Un `bytes=N-` sale como `bytes=N-(N+2MiB-1)`, no como el resto del archivo.
 */
export const VIDEO_OPEN_BYTES = 2 * 1024 * 1024;

/** Acota cualquier Range a una ventana de 2 MiB a partir de su inicio. */
export function boundedVideoRange(range: string | null | undefined): string {
  const header = mediaRangeHeader(range ?? null);
  const cap = VIDEO_OPEN_BYTES;
  if (!header) return `bytes=0-${cap - 1}`;
  const match = /^bytes=(\d+)-(\d*)$/.exec(header);
  if (!match) return `bytes=0-${cap - 1}`;
  const start = Number(match[1]);
  const end = match[2] === "" ? null : Number(match[2]);
  const maxEnd = start + cap - 1;
  if (end == null || end > maxEnd) return `bytes=${start}-${maxEnd}`;
  return header;
}

/** Dos páginas de la bóveda (40 + 40) y un margen, para no perder la anterior al pasar de página. */
export const VAULT_THUMB_CACHE_MAX = 160;
/** Tope de bytes vivos. Una miniatura que no cabe no entra. */
export const VAULT_THUMB_CACHE_BYTES = 24 * 1024 * 1024;
const THUMB_TTL_MS = 10 * 60_000;

const thumbCache = new Map<string, { body: Uint8Array; contentType: string; at: number }>();
let thumbBytes = 0;
let thumbNow = (): number => Date.now();

export function setVaultThumbClock(clock: () => number): void {
  thumbNow = clock;
}

export function clearVaultThumbs(): void {
  thumbCache.clear();
  thumbBytes = 0;
  thumbNotes.clear();
  thumbRecovered.clear();
}

function thumbKey(creatorId: string, mediaId: string, variant = "preview"): string {
  return `${creatorId}\n${variant}\n${mediaId}`;
}

function forgetThumb(key: string): void {
  const hit = thumbCache.get(key);
  if (!hit) return;
  thumbBytes -= hit.body.byteLength;
  thumbCache.delete(key);
}

export function putVaultThumb(creatorId: string, mediaId: string, body: Uint8Array, contentType: string, variant = "preview"): void {
  const key = thumbKey(creatorId, mediaId, variant);
  forgetThumb(key);
  if (body.byteLength > VAULT_THUMB_CACHE_BYTES) return;
  thumbCache.set(key, { body, contentType, at: thumbNow() });
  thumbBytes += body.byteLength;
  while (thumbCache.size > VAULT_THUMB_CACHE_MAX || thumbBytes > VAULT_THUMB_CACHE_BYTES) {
    const oldest = thumbCache.keys().next().value;
    if (oldest === undefined) break;
    forgetThumb(oldest);
  }
}

export function getVaultThumb(creatorId: string, mediaId: string, variant = "preview"): { body: Uint8Array; contentType: string } | null {
  const key = thumbKey(creatorId, mediaId, variant);
  const hit = thumbCache.get(key);
  if (!hit) return null;
  if (thumbNow() - hit.at > THUMB_TTL_MS) {
    forgetThumb(key);
    return null;
  }
  thumbCache.delete(key);
  thumbCache.set(key, hit);
  return { body: hit.body, contentType: hit.contentType };
}

export type MediaBytes = {
  status: number;
  /** Solo en pruebas. El camino real no junta el archivo en un buffer. */
  body?: Uint8Array;
  stream?: ReadableStream<Uint8Array> | null;
  contentType: string;
  contentRange?: string | null;
  contentLength?: number | null;
};

/** Solo un Range de bytes. Cualquier otra cabecera se ignora. */
export function mediaRangeHeader(range: string | null | undefined): string | null {
  if (!range) return null;
  const match = /^bytes=(\d+)-(\d*)$/.exec(range.trim());
  if (!match) return null;
  const start = Number(match[1]);
  const end = match[2] === "" ? null : Number(match[2]);
  if (!Number.isInteger(start) || start < 0) return null;
  if (end != null && (!Number.isInteger(end) || end < start)) return null;
  return end == null ? `bytes=${start}-` : `bytes=${start}-${end}`;
}

/** El cuerpo sigue siendo un stream. No se lee entero aquí. */
export function mediaFromFetchResponse(response: Response): MediaBytes | null {
  if (response.status === 416) {
    return {
      status: 416,
      body: new Uint8Array(),
      contentType: response.headers.get("content-type") ?? "video/mp4",
      contentRange: response.headers.get("content-range"),
      contentLength: 0,
    };
  }
  if (response.status !== 200 && response.status !== 206) return null;
  if (!response.body) return null;
  const length = response.headers.get("content-length");
  const parsed = length == null ? null : Number(length);
  return {
    status: response.status,
    stream: response.body,
    contentType: response.headers.get("content-type") ?? "application/octet-stream",
    contentRange: response.headers.get("content-range"),
    contentLength: parsed != null && Number.isFinite(parsed) ? parsed : null,
  };
}

type LoadResult = MediaBytes | { status: number };

function asMedia(result: LoadResult): MediaBytes | null {
  if (!("contentType" in result)) return null;
  return result;
}

/**
 * Pide el Range y devuelve el stream del CDN. No llama a arrayBuffer ni
 * junta el archivo en memoria. Un redirect no se sigue a un host distinto
 * de OnlyFans, CloudFront o S3.
 */
export async function readSessionMediaBytes(
  creatorId: string,
  target: string,
  range?: string | null,
): Promise<MediaBytes | null> {
  const result = await readSessionMediaResult(creatorId, target, range);
  return result.media;
}

/**
 * La URL firmada del CDN suele responder 403 si va la cookie de OnlyFans.
 * Primero se pide sin cookie. Si sigue en 403 o 410, se reintenta con la sesión.
 */
export function mediaHeaderAttempts(headers: Record<string, string>): Array<Record<string, string>> {
  if (!headers.cookie) return [headers];
  const bare = { ...headers };
  delete bare.cookie;
  return [bare, headers];
}

/** Igual que `readSessionMediaBytes`, pero conserva el status cuando el CDN rechaza la URL. */
export async function readSessionMediaResult(
  creatorId: string,
  target: string,
  range?: string | null,
  options?: { expectVideo?: boolean; signal?: AbortSignal },
): Promise<{ status: number; media: MediaBytes | null }> {
  if (!mediaHostAllowed(target)) return { status: 0, media: null };
  const header = mediaRangeHeader(range);
  try {
    // Import en línea: este módulo y el runtime se referencian al pedir bytes de una cuenta.
    const { getOfSessionManager } = await import("../../../src/lib/of-sessions-runtime.server.ts");
    const sessions = await getOfSessionManager();
    const account = (await sessions.listAccounts()).find((item) => item.creatorId === creatorId);
    if (!account || account.status !== "active" || !account.hasStorageState) return { status: 0, media: null };
    const state = await sessions.readStorageState(account.id);
    const auth = sessionForApi(state, Date.now());
    const cookie = "cookie" in auth ? auth.cookie : "";
    const headers: Record<string, string> = {
      accept: mediaAcceptHeader(target, header, options?.expectVideo === true),
      referer: "https://onlyfans.com/",
      origin: "https://onlyfans.com",
      "user-agent": BROWSER_FINGERPRINT.userAgent,
    };
    if (cookie) headers.cookie = cookie;
    if (header) headers.range = header;
    let lastStatus = 0;
    const attempts = mediaHeaderAttempts(headers);
    for (let index = 0; index < attempts.length; index += 1) {
      const attempt = attempts[index] ?? headers;
      const loaded = await loadMedia(target, attempt, options?.expectVideo === true, options?.signal);
      const media = asMedia(loaded);
      if (media) {
        if (index > 0 && !options?.expectVideo) noteVaultThumbRecovered(creatorId, media.status);
        return { status: media.status, media };
      }
      lastStatus = loaded.status;
      if (lastStatus === 403 || lastStatus === 410) {
        if (options?.expectVideo) console.info(`[fanlink:vault] reproductor error status=${lastStatus} motivo=cdn`);
        else noteVaultThumb(lastStatus, attempt.cookie ? "sesion" : "sin-cookie");
      } else break;
    }
    return { status: lastStatus, media: null };
  } catch {
    return { status: 0, media: null };
  }
}

/** Un vídeo no se sirve si el CDN manda una imagen. Un binario vale si trae `ftyp`. */
export function videoBytesAccepted(contentType: string, head?: Uint8Array): boolean {
  const type = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (type.startsWith("video/")) return true;
  if (type.startsWith("image/")) return false;
  if (type === "" || type === "application/octet-stream" || type === "binary/octet-stream") return head ? hasFtyp(head) : false;
  return false;
}

export function hasFtyp(bytes: Uint8Array): boolean {
  const limit = Math.min(bytes.length - 3, 32);
  for (let index = 0; index <= limit; index += 1) {
    if (bytes[index] === 0x66 && bytes[index + 1] === 0x74 && bytes[index + 2] === 0x79 && bytes[index + 3] === 0x70) return true;
  }
  return false;
}

/** Tras un 403 de un vídeo no se pide la miniatura. Una imagen no se reintenta como vídeo. */
export function videoFollowUp(status: number, contentType: string | null, expectVideo: boolean): "serve" | "refresh" | "drop" {
  const type = (contentType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  if (expectVideo && type.startsWith("image/")) return "drop";
  if (status === 403 || status === 410) return "refresh";
  if (status === 200 || status === 206) return "serve";
  return "drop";
}

export async function fetchVaultMedia(target: string, headers: Record<string, string>, expectVideo = false, signal?: AbortSignal): Promise<LoadResult> {
  return loadMedia(target, headers, expectVideo, signal);
}

async function loadMedia(target: string, headers: Record<string, string>, expectVideo = false, client?: AbortSignal): Promise<LoadResult> {
  const outbound = { ...headers };
  if (expectVideo) outbound.range = boundedVideoRange(headers.range);
  const controller = new AbortController();
  const headerTimeout = expectVideo ? AbortSignal.timeout(VIDEO_FETCH_TIMEOUT_MS) : null;
  const stopTimeout = headerTimeout ? linkAbort(headerTimeout, controller) : () => undefined;
  if (client) linkAbort(client, controller);
  const signal = expectVideo || client ? controller.signal : undefined;
  let response: Response;
  try {
    response = await fetch(target, { headers: outbound, redirect: "manual", signal });
  } catch (error) {
    stopTimeout();
    if (expectVideo && headerTimeout?.aborted && !client?.aborted) console.info("[fanlink:vault] reproductor error motivo=timeout");
    return { status: 0 };
  }
  stopTimeout();
  if (response.status >= 300 && response.status < 400) {
    const next = nextMediaUrl(target, response.headers.get("location"));
    await response.body?.cancel().catch(() => undefined);
    if (!next) return { status: response.status };
    try {
      response = await fetch(next, { headers: outbound, redirect: "manual", signal });
    } catch (error) {
      if (expectVideo && headerTimeout?.aborted && !client?.aborted) console.info("[fanlink:vault] reproductor error motivo=timeout");
      return { status: 0 };
    }
  }
  if (response.status === 416) {
    const ranged = mediaFromFetchResponse(response);
    if (ranged) return ranged;
  }
  if (!response.ok && response.status !== 206) {
    await response.body?.cancel().catch(() => undefined);
    return { status: response.status };
  }
  const upstreamType = (response.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  const video = expectVideo || upstreamType.startsWith("video/") || isVideoTarget(target);
  if (expectVideo && !videoBytesAccepted(upstreamType) && !ambiguousVideoType(upstreamType)) {
    await response.body?.cancel().catch(() => undefined);
    console.info(`[fanlink:vault] reproductor error tipo=${upstreamType || "sin"}`);
    return { status: response.status };
  }
  if (video || (expectVideo && ambiguousVideoType(upstreamType))) {
    const media = mediaFromFetchResponse(response);
    if (!media) {
      await response.body?.cancel().catch(() => undefined);
      return { status: response.status };
    }
    const atStart = rangeOpensAtZero(outbound.range);
    if (expectVideo && ambiguousVideoType(upstreamType) && atStart && media.stream) {
      const peeked = await peekFtyp(media.stream);
      media.stream = peeked.stream;
      const container = videoContainer({ url: target, contentType: upstreamType, head: peeked.head });
      console.info(`[fanlink:vault] reproductor contenedor=${container}`);
      if (container === "avi") {
        console.info("[fanlink:vault] reproductor error tipo=avi motivo=navegador");
        return { status: 415 };
      }
      const served = browserVideoType(container);
      if (!served) {
        console.info(`[fanlink:vault] reproductor error tipo=${upstreamType || "sin"} motivo=sin-ftyp`);
        return { status: response.status };
      }
      media.contentType = served;
    } else if (expectVideo && videoContainer({ url: target, contentType: media.contentType }) === "avi") {
      console.info("[fanlink:vault] reproductor error tipo=avi motivo=navegador");
      return { status: 415 };
    } else if (expectVideo && !ambiguousVideoType(upstreamType) && !videoBytesAccepted(media.contentType)) {
      console.info(`[fanlink:vault] reproductor error tipo=${media.contentType || "sin"}`);
      return { status: response.status };
    }
    console.info(vaultPlayerLog({
      status: media.status,
      range: outbound.range ?? null,
      contentRange: media.contentRange ?? null,
      contentType: media.contentType,
      bytes: media.contentLength ?? null,
    }));
    return media;
  }
  const raw = new Uint8Array(await response.arrayBuffer());
  if (raw.byteLength === 0 || raw.byteLength > 8_000_000) return { status: response.status };
  const type = (response.headers.get("content-type") ?? "application/octet-stream").split(";")[0] ?? "application/octet-stream";
  if (type.startsWith("text/")) return { status: response.status };
  return { status: response.status, body: raw, contentType: type, contentLength: raw.byteLength };
}

const thumbNotes = new Set<string>();
const thumbRecovered = new Set<string>();

/** Una miniatura pide imagen, aunque lleve Range. Solo un vídeo pide vídeo. */
export function mediaAcceptHeader(target: string, _range: string | null, expectVideo = false): string {
  if (expectVideo || isVideoTarget(target)) return "video/*,*/*";
  return "image/avif,image/webp,image/apng,image/*,*/*;q=0.8";
}

function rangeOpensAtZero(range: string | undefined): boolean {
  if (!range) return true;
  const match = /^bytes=(\d+)-/i.exec(range.trim());
  if (!match) return true;
  return Number(match[1]) === 0;
}

function linkAbort(from: AbortSignal, to: AbortController): () => void {
  const onAbort = () => to.abort(from.reason);
  if (from.aborted) {
    to.abort(from.reason);
    return () => undefined;
  }
  from.addEventListener("abort", onAbort, { once: true });
  return () => from.removeEventListener("abort", onAbort);
}

function ambiguousVideoType(type: string): boolean {
  return type === "" || type === "application/octet-stream" || type === "binary/octet-stream";
}

async function peekFtyp(stream: ReadableStream<Uint8Array>): Promise<{ head: Uint8Array; stream: ReadableStream<Uint8Array> }> {
  const reader = stream.getReader();
  const first = await reader.read();
  const chunk = first.value ?? new Uint8Array();
  const head = chunk.subarray(0, 32);
  const rest = new ReadableStream<Uint8Array>({
    async start(controller) {
      if (chunk.byteLength > 0) controller.enqueue(chunk);
      if (first.done) {
        controller.close();
        return;
      }
      while (true) {
        const next = await reader.read();
        if (next.done) {
          controller.close();
          return;
        }
        if (next.value) controller.enqueue(next.value);
      }
    },
  });
  return { head, stream: rest };
}

function isVideoTarget(url: string): boolean {
  const path = url.split("?")[0]?.toLowerCase() ?? "";
  return path.endsWith(".mp4") || path.endsWith(".webm") || path.endsWith(".mov") || path.endsWith(".m4v");
}

export function vaultPlayerLog(input: {
  status: number;
  range: string | null;
  contentRange: string | null;
  contentType: string;
  bytes: number | null;
}): string {
  const clean = (value: string) => value.replace(/https?:\/\/\S+/gi, "").replace(/[\r\n]/g, " ").trim().slice(0, 80);
  const range = input.range ? clean(input.range) : "no";
  const back = input.contentRange ? clean(input.contentRange) : "no";
  const type = clean(input.contentType || "sin").split(";")[0] || "sin";
  return `[fanlink:vault] reproductor status=${input.status} range=${range} devuelto=${back} tipo=${type} bytes=${input.bytes ?? "sin"}`;
}

export function noteVaultThumb(status: number, intento?: string): void {
  const key = `${status}:${intento ?? ""}`;
  if (thumbNotes.has(key)) return;
  thumbNotes.add(key);
  const suffix = intento ? ` intento=${intento}` : "";
  console.info(`[fanlink:vault] miniatura status=${status}${suffix}`);
}

export function noteVaultThumbRecovered(creatorId: string, status: number): void {
  if (thumbRecovered.has(creatorId)) return;
  thumbRecovered.add(creatorId);
  console.info(`[fanlink:vault] miniatura status=${status} reintento=sesion`);
}
