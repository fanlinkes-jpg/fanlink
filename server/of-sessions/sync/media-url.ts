import type { ChatMedia } from "./chats.ts";

/** Hosts de OnlyFans y su CDN. Un redirect a otro sitio no se sigue. */
export function mediaHostAllowed(raw: string): boolean {
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
    const host = parsed.hostname.toLowerCase();
    if (host !== "onlyfans.com" && !host.endsWith(".onlyfans.com")) return false;
    const path = parsed.pathname.toLowerCase();
    return !path.includes("/api2/") && !path.includes("/api/");
  } catch {
    return false;
  }
}

export function nextMediaUrl(current: string, location: string | null): string | null {
  if (!location) return null;
  try {
    const next = new URL(location, current).toString();
    return mediaHostAllowed(next) ? next : null;
  } catch {
    return null;
  }
}

export function canProxyMedia(url: string): boolean {
  return mediaHostAllowed(url);
}

export const PREVIEW_MAX_BYTES = 5_000_000;
export const PREVIEW_TIMEOUT_MS = 8_000;
/** Reloj de toda la miniatura. Un goteo por debajo del silencio no la alarga. */
export const PREVIEW_TOTAL_TIMEOUT_MS = 20_000;

export function encodeMedia(media: ChatMedia[] | null | undefined): string | null {
  if (!media || media.length === 0) return null;
  return JSON.stringify(media);
}

export function decodeMedia(raw: string | null): ChatMedia[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    return parsed.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const row = item as Partial<ChatMedia>;
      if (row.kind != null && row.kind !== "foto" && row.kind !== "video" && row.kind !== "audio") return [];
      return [{
        kind: row.kind ?? null,
        seconds: typeof row.seconds === "number" ? row.seconds : null,
        preview: typeof row.preview === "string" ? row.preview : null,
        full: typeof row.full === "string" ? row.full : null,
        locked: typeof row.locked === "boolean" ? row.locked : null,
        priceCents: typeof row.priceCents === "number" ? row.priceCents : null,
        paid: typeof row.paid === "boolean" ? row.paid : null,
        opened: typeof row.opened === "boolean" ? row.opened : null,
        vaultId: typeof row.vaultId === "string" ? row.vaultId : null,
      }];
    });
  } catch {
    return null;
  }
}

/** Lee como mucho el tope. El silencio corta, y también el reloj total. */
export async function readCappedBytes(
  body: ReadableStream<Uint8Array> | null,
  maxBytes = PREVIEW_MAX_BYTES,
  idleMs = PREVIEW_TIMEOUT_MS,
  totalMs = PREVIEW_TOTAL_TIMEOUT_MS,
): Promise<Uint8Array | null> {
  if (!body) return null;
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let seen = 0;
  const started = Date.now();
  try {
    for (;;) {
      const remaining = totalMs - (Date.now() - started);
      const next = await readWithLimit(reader.read(), Math.min(idleMs, remaining));
      if (next.done) break;
      seen += next.value.byteLength;
      if (seen > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(next.value);
    }
  } catch {
    await reader.cancel().catch(() => undefined);
    return null;
  }
  const out = new Uint8Array(seen);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function readWithLimit(work: Promise<ReadableStreamReadResult<Uint8Array>>, limitMs: number): Promise<ReadableStreamReadResult<Uint8Array>> {
  if (limitMs <= 0) return Promise.reject(new Error("total"));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("inactivo")), limitMs);
    work.then((value) => {
      clearTimeout(timer);
      resolve(value);
    }, (error: unknown) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

export async function followMedia(
  start: string,
  load: (url: string) => Promise<{ status: number; location: string | null; body: Uint8Array | null }>,
  timeoutMs = PREVIEW_TIMEOUT_MS,
  totalMs = PREVIEW_TOTAL_TIMEOUT_MS,
): Promise<Uint8Array | null> {
  const started = Date.now();
  let current = start;
  for (let hop = 0; hop < 3; hop += 1) {
    if (Date.now() - started > totalMs) return null;
    if (!mediaHostAllowed(current)) return null;
    const response = await new Promise<{ status: number; location: string | null; body: Uint8Array | null } | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), timeoutMs);
      load(current).then((value) => {
        clearTimeout(timer);
        resolve(value);
      }, () => {
        clearTimeout(timer);
        resolve(null);
      });
    });
    if (!response) return null;
    if (response.status >= 300 && response.status < 400) {
      const next = nextMediaUrl(current, response.location);
      if (!next) return null;
      current = next;
      continue;
    }
    if (response.status < 200 || response.status >= 300 || !response.body) return null;
    if (response.body.byteLength === 0 || response.body.byteLength > PREVIEW_MAX_BYTES) return null;
    return response.body;
  }
  return null;
}
