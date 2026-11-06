import { canProxyMedia, followMedia, PREVIEW_MAX_BYTES, PREVIEW_TIMEOUT_MS } from "./history.ts";
import { PREVIEW_TOTAL_TIMEOUT_MS, previewSource, readSessionMedia, sessionUpstream, type SessionRequest } from "./media-session.ts";
import { fetchUpstream, openMediaStream, type StreamOpen } from "./media-stream.ts";

/** Ejecuta la lectura dentro del navegador de la sesión, con el contexto aún abierto. */
export type SessionRun = <T>(task: (request: SessionRequest) => Promise<T>) => Promise<T | null>;

/**
 * Con sesión no hay fetch del servidor: ni sin cookies ni con cookies copiadas.
 * Sin sesión, el GET no lleva Cookie.
 */
export async function loadPreviewBytes(preview: string, session: SessionRun | null): Promise<Uint8Array | null> {
  if (!canProxyMedia(preview)) return null;
  if (previewSource(session != null) === "navegador" && session) {
    return session((request) => readSessionMedia(request, preview));
  }
  return followMedia(preview, (current) => loadCappedPreview(current));
}

export async function openPlayable(target: string, range: string | null, session: SessionRun | null, now = Date.now()): Promise<StreamOpen> {
  if (session) {
    const opened = await session((request) => openMediaStream(target, range, (url, headers) => sessionUpstream(request, url, headers), now));
    return opened ?? { ok: false, status: 410, reason: "caducado" };
  }
  return openMediaStream(target, range, (url, headers) => fetchUpstream(url, headers), now);
}

async function loadCappedPreview(current: string): Promise<{ status: number; location: string | null; body: Uint8Array | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PREVIEW_TIMEOUT_MS);
  const response = await fetch(current, { redirect: "manual", signal: controller.signal }).catch(() => null);
  clearTimeout(timer);
  if (!response) return { status: 0, location: null, body: null };
  if (response.status >= 300 && response.status < 400) {
    return { status: response.status, location: response.headers.get("location"), body: null };
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    return { status: response.status, location: null, body: null };
  }
  const announced = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(announced) && announced > PREVIEW_MAX_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    return { status: response.status, location: null, body: null };
  }
  return { status: response.status, location: null, body: await readPreviewBody(response.body) };
}

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
