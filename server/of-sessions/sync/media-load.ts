import { previewSource, readSessionMedia, sessionUpstream, type SessionRequest } from "./media-session.ts";
import { canProxyMedia, followMedia, readCappedBytes, PREVIEW_MAX_BYTES, PREVIEW_TIMEOUT_MS } from "./media-url.ts";
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
  return { status: response.status, location: null, body: await readCappedBytes(response.body) };
}
