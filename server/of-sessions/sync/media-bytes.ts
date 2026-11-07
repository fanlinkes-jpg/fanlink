import { mediaHostAllowed } from "./history.ts";

export type MediaBytes = {
  status: number;
  body: Uint8Array;
  contentType: string;
  contentRange?: string | null;
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

/**
 * Pide solo el trozo del Range. No se descarga el archivo entero si el CDN
 * responde 206. Sin Range, el cuerpo es el que devuelva el origen.
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
    return await sessions.withSession(account.id, async (context) => {
      const response = await context.request.get(target, {
        timeout: 20_000,
        maxRedirects: 0,
        headers: header ? { Range: header } : undefined,
      });
      const status = response.status();
      if (status !== 200 && status !== 206) return null;
      const body = await response.body();
      const contentType = response.headers()["content-type"] ?? "application/octet-stream";
      const contentRange = response.headers()["content-range"] ?? null;
      return { status, body, contentType, contentRange };
    });
  } catch {
    return null;
  }
}