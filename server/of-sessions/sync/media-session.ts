import { BROWSER_FINGERPRINT } from "../sessions/browser-factory.ts";
import { PREVIEW_MAX_BYTES, mediaHostAllowed, nextMediaUrl } from "./history.ts";
import { MEDIA_FETCH_TIMEOUT_MS, MEDIA_MAX_BYTES, type UpstreamResponse } from "./media-stream.ts";

/** Reloj de toda la miniatura. history.ts del hilo solo corta por silencio. */
export const PREVIEW_TOTAL_TIMEOUT_MS = 20_000;

/**
 * `context.request` de la sesión. Comparte proxy, cookies y huella del perfil.
 * No se le pasa una cabecera Cookie copiada.
 */
export type SessionRequest = {
  get(url: string, init: { timeout: number; maxRedirects: 0; headers?: Record<string, string> }): Promise<SessionResponse>;
};

export type SessionResponse = {
  status(): number;
  headers(): Record<string, string> | { get(name: string): string | null };
  body(): Promise<Uint8Array>;
};

/** Con sesión, la miniatura sale del navegador. Sin sesión, un GET sin cookies. */
export function previewSource(hasSession: boolean): "navegador" | "directo" {
  return hasSession ? "navegador" : "directo";
}

export function sessionHeaders(extra: Headers | undefined, userAgent: string = BROWSER_FINGERPRINT.userAgent): Record<string, string> {
  const headers: Record<string, string> = { "user-agent": userAgent };
  extra?.forEach((value, key) => {
    if (key.toLowerCase() === "cookie" || key.toLowerCase() === "user-agent") return;
    headers[key] = value;
  });
  return headers;
}

function headerValue(headers: Record<string, string> | { get(name: string): string | null }, name: string): string | null {
  if (typeof (headers as { get?: unknown }).get === "function") {
    return (headers as { get(name: string): string | null }).get(name);
  }
  const record = headers as Record<string, string>;
  const key = Object.keys(record).find((item) => item.toLowerCase() === name.toLowerCase());
  return key ? record[key] ?? null : null;
}

/**
 * Lee la miniatura con el navegador de la sesión.
 * El content-length por encima del tope no llama a body(). El reloj total corta un goteo.
 */
export async function readSessionMedia(
  request: SessionRequest,
  start: string,
  options: { timeoutMs?: number; totalMs?: number; maxBytes?: number; userAgent?: string } = {},
): Promise<Uint8Array | null> {
  const totalMs = options.totalMs ?? PREVIEW_TOTAL_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? PREVIEW_MAX_BYTES;
  const userAgent = options.userAgent ?? BROWSER_FINGERPRINT.userAgent;
  const started = Date.now();
  let current = start;
  for (let hop = 0; hop < 3; hop += 1) {
    const remaining = totalMs - (Date.now() - started);
    if (remaining <= 0 || !mediaHostAllowed(current)) return null;
    const deadline = wait(remaining);
    const response = await Promise.race([
      request.get(current, {
        timeout: Math.min(options.timeoutMs ?? remaining, remaining),
        maxRedirects: 0,
        headers: sessionHeaders(undefined, userAgent),
      }).then((value) => value, () => null).finally(deadline.cancel),
      deadline.done.then(() => null),
    ]);
    if (!response) return null;
    const status = response.status();
    if (status >= 300 && status < 400) {
      const next = nextMediaUrl(current, headerValue(response.headers(), "location"));
      if (!next) return null;
      current = next;
      continue;
    }
    if (status < 200 || status >= 300) return null;
    const announced = Number(headerValue(response.headers(), "content-length") ?? "");
    if (Number.isFinite(announced) && announced > maxBytes) return null;
    const bytes = await response.body();
    if (bytes.byteLength === 0 || bytes.byteLength > maxBytes) return null;
    return bytes;
  }
  return null;
}

/** Un trozo de vídeo por el mismo navegador. El cuerpo ya está en memoria, acotado. */
export async function sessionUpstream(
  request: SessionRequest,
  url: string,
  headers: Headers,
  userAgent = BROWSER_FINGERPRINT.userAgent,
  maxBytes = MEDIA_MAX_BYTES,
  timeoutMs = MEDIA_FETCH_TIMEOUT_MS,
): Promise<UpstreamResponse> {
  if (!mediaHostAllowed(url)) return { status: 403, location: null, headers: new Headers(), body: null };
  const deadline = wait(timeoutMs);
  const response = await Promise.race([
    request.get(url, { timeout: timeoutMs, maxRedirects: 0, headers: sessionHeaders(headers, userAgent) }).then((value) => value, () => null).finally(deadline.cancel),
    deadline.done.then(() => null),
  ]);
  if (!response) return { status: 0, location: null, headers: new Headers(), body: null };
  const rawHeaders = response.headers();
  const out = new Headers();
  if (typeof (rawHeaders as { get?: unknown }).get === "function") {
    for (const name of ["content-type", "content-length", "content-range", "location"]) {
      const value = (rawHeaders as { get(name: string): string | null }).get(name);
      if (value) out.set(name, value);
    }
  } else {
    for (const [key, value] of Object.entries(rawHeaders as Record<string, string>)) out.set(key, value);
  }
  const status = response.status();
  if (status >= 300 && status < 400) return { status, location: out.get("location"), headers: out, body: null };
  const announced = Number(out.get("content-length") ?? "");
  if (Number.isFinite(announced) && announced > maxBytes) {
    return { status: 416, location: null, headers: out, body: null };
  }
  if (status < 200 || status >= 300) return { status, location: null, headers: out, body: null };
  const bytes = await response.body();
  if (bytes.byteLength > maxBytes) return { status: 416, location: null, headers: out, body: null };
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      if (bytes.byteLength > 0) controller.enqueue(bytes);
      controller.close();
    },
  });
  return { status, location: null, headers: out, body };
}

function wait(ms: number): { done: Promise<void>; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const done = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms);
  });
  return { done, cancel: () => clearTimeout(timer) };
}

/** Adapta context.request. Las cookies las pone el navegador, no esta función. */
export function playwrightSessionRequest(request: {
  get(url: string, options?: { timeout?: number; maxRedirects?: number; headers?: Record<string, string> }): Promise<{
    status(): number;
    headers(): Record<string, string>;
    body(): Promise<Uint8Array>;
  }>;
}): SessionRequest {
  return {
    async get(url, init) {
      const response = await request.get(url, init);
      return {
        status: () => response.status(),
        headers: () => response.headers(),
        body: async () => new Uint8Array(await response.body()),
      };
    },
  };
}
