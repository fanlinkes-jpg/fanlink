import { sessionForApi } from "./of-chat-api.ts";
import { mediaHostAllowed, nextMediaUrl } from "./history.ts";
import { BROWSER_FINGERPRINT } from "../sessions/browser-factory.ts";

/** Dos páginas de la bóveda (40 + 40) y un margen, para no perder la anterior al pasar de página. */
export const VAULT_THUMB_CACHE_MAX = 160;
const THUMB_TTL_MS = 10 * 60_000;

const thumbCache = new Map<string, { body: Uint8Array; contentType: string; at: number }>();
let thumbNow = (): number => Date.now();

export function setVaultThumbClock(clock: () => number): void {
  thumbNow = clock;
}

export function clearVaultThumbs(): void {
  thumbCache.clear();
}

function thumbKey(creatorId: string, mediaId: string): string {
  return `${creatorId}\n${mediaId}`;
}

export function putVaultThumb(creatorId: string, mediaId: string, body: Uint8Array, contentType: string): void {
  const key = thumbKey(creatorId, mediaId);
  thumbCache.delete(key);
  thumbCache.set(key, { body, contentType, at: thumbNow() });
  while (thumbCache.size > VAULT_THUMB_CACHE_MAX) {
    const oldest = thumbCache.keys().next().value;
    if (oldest === undefined) break;
    thumbCache.delete(oldest);
  }
}

export function getVaultThumb(creatorId: string, mediaId: string): { body: Uint8Array; contentType: string } | null {
  const key = thumbKey(creatorId, mediaId);
  const hit = thumbCache.get(key);
  if (!hit) return null;
  if (thumbNow() - hit.at > THUMB_TTL_MS) {
    thumbCache.delete(key);
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
      accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      referer: "https://onlyfans.com/",
      "user-agent": BROWSER_FINGERPRINT.userAgent,
    };
    if (cookie) headers.cookie = cookie;
    if (header) headers.range = header;
    const first = await loadMedia(target, headers, Boolean(header));
    const media = asMedia(first);
    if (media) return { status: media.status, media };
    if (!cookie) return { status: first.status, media: null };
    delete headers.cookie;
    const second = await loadMedia(target, headers, Boolean(header));
    const again = asMedia(second);
    if (again) return { status: again.status, media: again };
    const status = first.status === 403 || first.status === 410 ? first.status : second.status || first.status;
    return { status, media: null };
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
    noteThumb(response.status);
    await response.body?.cancel().catch(() => undefined);
    return { status: response.status };
  }
  if (ranged) {
    const media = mediaFromFetchResponse(response);
    if (!media) {
      await response.body?.cancel().catch(() => undefined);
      return { status: response.status };
    }
    return media;
  }
  const raw = new Uint8Array(await response.arrayBuffer());
  if (raw.byteLength === 0 || raw.byteLength > 8_000_000) return { status: response.status };
  const type = (response.headers.get("content-type") ?? "application/octet-stream").split(";")[0] ?? "application/octet-stream";
  if (type.startsWith("text/")) return { status: response.status };
  return { status: response.status, body: raw, contentType: type, contentLength: raw.byteLength };
}

let thumbsNoted = 0;

function noteThumb(status: number): void {
  if (thumbsNoted >= 3) return;
  thumbsNoted += 1;
  console.info(`[fanlink:vault] miniatura status=${status}`);
}
