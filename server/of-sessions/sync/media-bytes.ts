import { sessionForApi } from "./of-chat-api.ts";
import { mediaHostAllowed, nextMediaUrl } from "./history.ts";
import { BROWSER_FINGERPRINT } from "../sessions/browser-factory.ts";

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

function thumbKey(creatorId: string, mediaId: string): string {
  return `${creatorId}\n${mediaId}`;
}

function forgetThumb(key: string): void {
  const hit = thumbCache.get(key);
  if (!hit) return;
  thumbBytes -= hit.body.byteLength;
  thumbCache.delete(key);
}

export function putVaultThumb(creatorId: string, mediaId: string, body: Uint8Array, contentType: string): void {
  const key = thumbKey(creatorId, mediaId);
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

export function getVaultThumb(creatorId: string, mediaId: string): { body: Uint8Array; contentType: string } | null {
  const key = thumbKey(creatorId, mediaId);
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
      accept: mediaAcceptHeader(target, header),
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
      const loaded = await loadMedia(target, attempt, Boolean(header));
      const media = asMedia(loaded);
      if (media) {
        if (index > 0) noteVaultThumbRecovered(creatorId, media.status);
        return { status: media.status, media };
      }
      lastStatus = loaded.status;
      if (lastStatus === 403 || lastStatus === 410) noteVaultThumb(lastStatus, attempt.cookie ? "sesion" : "sin-cookie");
      else break;
    }
    return { status: lastStatus, media: null };
  } catch {
    return { status: 0, media: null };
  }
}

async function loadMedia(target: string, headers: Record<string, string>, ranged: boolean): Promise<LoadResult> {
  let response: Response;
  try {
    response = await fetch(target, { headers, redirect: "manual" });
  } catch {
    return { status: 0 };
  }
  if (response.status >= 300 && response.status < 400) {
    const next = nextMediaUrl(target, response.headers.get("location"));
    await response.body?.cancel().catch(() => undefined);
    if (!next) return { status: response.status };
    try {
      response = await fetch(next, { headers, redirect: "manual" });
    } catch {
      return { status: 0 };
    }
  }
  if (!response.ok && response.status !== 206) {
    await response.body?.cancel().catch(() => undefined);
    return { status: response.status };
  }
  const upstreamType = (response.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  const video = ranged || upstreamType.startsWith("video/") || isVideoTarget(target);
  if (video) {
    const media = mediaFromFetchResponse(response);
    if (!media) {
      await response.body?.cancel().catch(() => undefined);
      return { status: response.status };
    }
    if (!media.contentType.startsWith("video/") && isVideoTarget(target)) media.contentType = "video/mp4";
    console.info(vaultPlayerLog({
      status: media.status,
      range: headers.range ?? null,
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

/** Una miniatura pide imagen. Un vídeo, o un Range de vídeo, pide vídeo. */
export function mediaAcceptHeader(target: string, range: string | null): string {
  if (range || isVideoTarget(target)) return "video/*,*/*";
  return "image/avif,image/webp,image/apng,image/*,*/*;q=0.8";
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
