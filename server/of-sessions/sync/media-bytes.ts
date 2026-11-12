import { mediaHostAllowed, nextMediaUrl } from "./history.ts";
import { sessionForApi } from "./of-chat-api.ts";
import { BROWSER_FINGERPRINT } from "../sessions/browser-factory.ts";

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

/**
 * Pide el Range y devuelve el stream del CDN. No llama a arrayBuffer ni
 * junta el archivo en memoria. Un redirect no se sigue.
 */
export async function readSessionMediaBytes(
  creatorId: string,
  target: string,
  range?: string | null,
): Promise<MediaBytes | null> {
  if (!mediaHostAllowed(target)) return null;
  const header = mediaRangeHeader(range);
  try {
    const { getOfSessionManager } = await import("../../../src/lib/of-sessions-runtime.server.ts");
    const sessions = await getOfSessionManager();
    const account = (await sessions.listAccounts()).find((item) => item.creatorId === creatorId);
    if (!account || account.status !== "active" || !account.hasStorageState) return null;
    const state = await sessions.readStorageState(account.id);
    const auth = sessionForApi(state, Date.now());
    if ("reason" in auth) return null;
    const headers: Record<string, string> = {
      referer: "https://onlyfans.com/",
      cookie: auth.cookie,
      "user-agent": BROWSER_FINGERPRINT.userAgent,
    };
    if (header) headers.range = header;
    let response = await fetch(target, { headers, redirect: "manual" });
    if (response.status >= 300 && response.status < 400) {
      const next = nextMediaUrl(target, response.headers.get("location"));
      await response.body?.cancel().catch(() => undefined);
      if (!next) return null;
      response = await fetch(next, { headers, redirect: "manual" });
    }
    if (header) {
      const media = mediaFromFetchResponse(response);
      if (!media) await response.body?.cancel().catch(() => undefined);
      return media;
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return null;
    }
    const raw = new Uint8Array(await response.arrayBuffer());
    if (raw.byteLength > 8_000_000) return null;
    const type = (response.headers.get("content-type") ?? "application/octet-stream").split(";")[0] ?? "application/octet-stream";
    return { status: response.status, body: raw, contentType: type, contentLength: raw.byteLength };
  } catch {
    return null;
  }
}