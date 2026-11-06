import { PREVIEW_MAX_BYTES, PREVIEW_TIMEOUT_MS } from "./history.ts";

/** Reloj de toda la miniatura. history.ts del hilo solo corta por silencio. */
export const PREVIEW_TOTAL_TIMEOUT_MS = 20_000;

/** Lee como mucho el tope. El silencio corta, y también el reloj total. */
export async function readPreviewBody(
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

export function sniffMedia(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return "image/png";
  if (bytes[0] === 0x47 && bytes[1] === 0x49) return "image/gif";
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[8] === 0x57 && bytes[9] === 0x45) return "image/webp";
  return "application/octet-stream";
}

export function mediaHeaders(bytes: Uint8Array): Record<string, string> {
  return {
    "content-type": sniffMedia(bytes),
    "x-content-type-options": "nosniff",
    "cache-control": "private, max-age=86400",
  };
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
