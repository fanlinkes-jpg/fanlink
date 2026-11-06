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
  | { ok: false; status: number; reason: "host" | "caducado" | "vacio" };

/** Reenvía Range y no sigue un redirect fuera de OnlyFans. No lee el cuerpo entero. */
export async function openMediaStream(
  upstream: string,
  range: string | null,
  load: (url: string, headers: Headers) => Promise<UpstreamResponse>,
  now = Date.now(),
): Promise<StreamOpen> {
  if (linkExpired(upstream, now)) return { ok: false, status: 410, reason: "caducado" };
  if (!mediaHostAllowed(upstream)) return { ok: false, status: 403, reason: "host" };
  let current = upstream;
  for (let hop = 0; hop < 3; hop += 1) {
    if (!mediaHostAllowed(current)) return { ok: false, status: 403, reason: "host" };
    const headers = new Headers();
    if (range) headers.set("range", range);
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
    if (response.status < 200 || response.status >= 300) return { ok: false, status: 404, reason: "vacio" };
    const out: Record<string, string> = { "accept-ranges": "bytes", "cache-control": "private, no-store" };
    const type = response.headers.get("content-type");
    if (type) out["content-type"] = type;
    const length = response.headers.get("content-length");
    if (length) out["content-length"] = length;
    const contentRange = response.headers.get("content-range");
    if (contentRange) out["content-range"] = contentRange;
    return { ok: true, status: response.status, headers: out, body: response.body };
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
