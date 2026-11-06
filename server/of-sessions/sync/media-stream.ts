import { mediaHostAllowed, nextMediaUrl } from "./history.ts";

export function linkExpired(raw: string, now = Date.now()): boolean {
  try {
    const url = new URL(raw);
    const exp = url.searchParams.get("Expires") ?? url.searchParams.get("expires") ?? url.searchParams.get("exp");
    if (!exp || !/^\d+$/.test(exp)) return false;
    const value = Number(exp);
    const ms = value < 10_000_000_000 ? value * 1000 : value;
    return ms <= now;
  } catch {
    return true;
  }
}

export type UpstreamResponse = {
  status: number;
  location: string | null;
  headers: Headers;
  body: ReadableStream<Uint8Array> | null;
};

export type StreamOpen =
  | { ok: true; status: number; headers: Record<string, string>; body: ReadableStream<Uint8Array> | null }
  | { ok: false; status: number; reason: "host" | "caducado" | "vacio" | "rango" };

/** Un solo trozo. Ni el vídeo ni un segmento pueden vaciar el proceso. */
export const MEDIA_MAX_BYTES = 8 * 1024 * 1024;
export const MEDIA_FETCH_TIMEOUT_MS = 12_000;

export type MediaRange = { ok: true; header: string } | { ok: false; status: 416 };

/**
 * Solo sale un `bytes=N-M` dentro del tope.
 * Sin cabecera, o `bytes=N-`, se recorta a ese tope. El resto es 416 y no se pide.
 */
export function acceptMediaRange(header: string | null, maxBytes = MEDIA_MAX_BYTES): MediaRange {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) return { ok: false, status: 416 };
  if (header == null || header.trim() === "") return { ok: true, header: `bytes=0-${maxBytes - 1}` };
  const text = header.trim();
  const open = /^bytes=(\d+)-$/.exec(text);
  if (open) {
    const start = Number(open[1]);
    if (!Number.isSafeInteger(start)) return { ok: false, status: 416 };
    const end = start + maxBytes - 1;
    if (!Number.isSafeInteger(end)) return { ok: false, status: 416 };
    return { ok: true, header: `bytes=${start}-${end}` };
  }
  const closed = /^bytes=(\d+)-(\d+)$/.exec(text);
  if (!closed) return { ok: false, status: 416 };
  const start = Number(closed[1]);
  const end = Number(closed[2]);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end < start) return { ok: false, status: 416 };
  if (end - start + 1 > maxBytes) return { ok: false, status: 416 };
  return { ok: true, header: `bytes=${start}-${end}` };
}

/** Corta el cuerpo si el origen ignora el Range y manda de más. */
export function capBody(body: ReadableStream<Uint8Array> | null, maxBytes = MEDIA_MAX_BYTES): ReadableStream<Uint8Array> | null {
  if (!body) return null;
  const reader = body.getReader();
  let seen = 0;
  return new ReadableStream({
    async pull(controller) {
      const next = await reader.read();
      if (next.done) {
        controller.close();
        return;
      }
      seen += next.value.byteLength;
      if (seen > maxBytes) {
        await reader.cancel().catch(() => undefined);
        controller.error(new Error("tope"));
        return;
      }
      controller.enqueue(next.value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

/** El fetch del proxy no espera ni lee sin límite. */
export async function fetchUpstream(
  url: string,
  headers: Headers,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = MEDIA_FETCH_TIMEOUT_MS,
  maxBytes = MEDIA_MAX_BYTES,
): Promise<UpstreamResponse> {
  const response = await fetchImpl(url, { headers, redirect: "manual", signal: AbortSignal.timeout(timeoutMs) }).catch(() => null);
  if (!response) return { status: 0, location: null, headers: new Headers(), body: null };
  const length = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(length) && length > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    return { status: 416, location: null, headers: response.headers, body: null };
  }
  return {
    status: response.status,
    location: response.headers.get("location"),
    headers: response.headers,
    body: capBody(response.body, maxBytes),
  };
}

/** Reenvía un único Range acotado y no sigue un redirect fuera de OnlyFans. */
export async function openMediaStream(
  upstream: string,
  range: string | null,
  load: (url: string, headers: Headers) => Promise<UpstreamResponse>,
  now = Date.now(),
): Promise<StreamOpen> {
  if (linkExpired(upstream, now)) return { ok: false, status: 410, reason: "caducado" };
  if (!mediaHostAllowed(upstream)) return { ok: false, status: 403, reason: "host" };
  const accepted = acceptMediaRange(range);
  if (!accepted.ok) return { ok: false, status: 416, reason: "rango" };
  let current = upstream;
  for (let hop = 0; hop < 3; hop += 1) {
    if (!mediaHostAllowed(current)) return { ok: false, status: 403, reason: "host" };
    const headers = new Headers();
    headers.set("range", accepted.header);
    const response = await load(current, headers);
    if (response.status >= 300 && response.status < 400) {
      const next = nextMediaUrl(current, response.location);
      if (!next) return { ok: false, status: 403, reason: "host" };
      current = next;
      continue;
    }
    if (response.status === 401 || response.status === 403 || response.status === 410) {
      return { ok: false, status: 410, reason: "caducado" };
    }
    if (response.status === 416) {
      await response.body?.cancel().catch(() => undefined);
      return { ok: false, status: 416, reason: "rango" };
    }
    if (response.status < 200 || response.status >= 300) {
      await response.body?.cancel().catch(() => undefined);
      return { ok: false, status: 404, reason: "vacio" };
    }
    const announced = Number(response.headers.get("content-length") ?? "");
    if (Number.isFinite(announced) && announced > MEDIA_MAX_BYTES) {
      await response.body?.cancel().catch(() => undefined);
      return { ok: false, status: 416, reason: "rango" };
    }
    const out: Record<string, string> = { "accept-ranges": "bytes", "cache-control": "private, no-store" };
    const type = response.headers.get("content-type");
    if (type) out["content-type"] = type;
    const length = response.headers.get("content-length");
    if (length) out["content-length"] = length;
    const contentRange = response.headers.get("content-range");
    if (contentRange) out["content-range"] = contentRange;
    return { ok: true, status: response.status, headers: out, body: capBody(response.body) };
  }
  return { ok: false, status: 404, reason: "vacio" };
}

export function playlistUrls(body: string, base: string): string[] {
  const urls: string[] = [];
  for (const line of body.split("\n")) {
    const uri = line.match(/URI="([^"]+)"/);
    if (uri?.[1]) {
      try { urls.push(new URL(uri[1], base).toString()); } catch { /* línea rota */ }
    }
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#")) {
      try { urls.push(new URL(trimmed, base).toString()); } catch { /* línea rota */ }
    }
  }
  return urls.filter((url) => mediaHostAllowed(url));
}

export function rewritePlaylist(body: string, base: string, proxy: (absolute: string) => string | null): string {
  return body.split("\n").map((line) => {
    const uri = line.match(/URI="([^"]+)"/);
    if (uri?.[1]) {
      let absolute = uri[1];
      try { absolute = new URL(uri[1], base).toString(); } catch { return line; }
      const next = proxy(absolute);
      return next ? line.replace(uri[1], next) : line;
    }
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return line;
    let absolute = trimmed;
    try { absolute = new URL(trimmed, base).toString(); } catch { return ""; }
    return proxy(absolute) ?? "";
  }).join("\n");
}

export function isHlsUrl(raw: string): boolean {
  try {
    return /\.m3u8$/i.test(new URL(raw).pathname);
  } catch {
    return false;
  }
}

/** La lista HLS se reutiliza unos segundos. Cada segmento no la vuelve a pedir. */
export const PLAYLIST_TTL_MS = 10_000;

const playlists = new Map<string, { body: string; at: number }>();

export function clearPlaylistCache(): void {
  playlists.clear();
}

export async function loadPlaylistCached(
  key: string,
  now: number,
  load: () => Promise<string | null>,
  ttl = PLAYLIST_TTL_MS,
): Promise<string | null> {
  const hit = playlists.get(key);
  if (hit && now - hit.at <= ttl) return hit.body;
  if (hit) playlists.delete(key);
  const body = await load();
  if (body != null) playlists.set(key, { body, at: now });
  return body;
}
