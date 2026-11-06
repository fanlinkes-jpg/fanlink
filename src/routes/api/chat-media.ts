import { createFileRoute } from "@tanstack/react-router";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { creatorIdsForChats } from "@/lib/access-policy";
import { DEV_USER_ID, authConfigured, requireUserId } from "@/lib/auth/verify.server";
import { getSql } from "@/lib/db";
import { getOfSessionManager } from "@/lib/of-sessions-runtime.server";
import { ensureStaff } from "@/lib/workspace-store";
import { loadCrmSessionConfig } from "../../../server/of-sessions/config.ts";
import { serveChatMedia } from "../../../server/of-sessions/sync/media-http.ts";
import { pruneMediaCache, shouldPruneMediaCache } from "../../../server/of-sessions/sync/media-cache.ts";
import { loadPreviewBytes, openPlayable, type SessionRun } from "../../../server/of-sessions/sync/media-load.ts";
import { mediaPlay } from "../../../server/of-sessions/sync/media-play.ts";
import { playwrightSessionRequest } from "../../../server/of-sessions/sync/media-session.ts";
import { isHlsUrl, loadPlaylistCached, playlistUrls, rewritePlaylist } from "../../../server/of-sessions/sync/media-stream.ts";
import { decodeMedia, mediaHostAllowed } from "../../../server/of-sessions/sync/media-url.ts";

export const Route = createFileRoute("/api/chat-media")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const userId = await requireUserId();
        const localOpen = !authConfigured && userId === DEV_USER_ID;
        const sql = await getSql();
        const access = await ensureStaff(sql, userId, localOpen);
        return serveChatMedia(request, {
          localOpen,
          role: access.role,
          perms: access.perms,
          creatorAllowed: (creatorId) => creatorIdsForChats(access, [creatorId]).includes(creatorId),
          findRow: async (creatorId, messageKey) => {
            const rows = await sql.query<{ thread_key: string }>(
              "select thread_key from of_chat_message where creator_id = $1 and message_key = $2",
              [creatorId, messageKey],
            );
            return rows[0] ? { threadKey: rows[0].thread_key } : null;
          },
          loadThumb: (creatorId, messageKey, threadKey, index) => loadPreview(creatorId, messageKey, threadKey, index),
          openFull: (incoming, creatorId, messageKey, threadKey, index, variant, segmentUrl) =>
            streamMedia(incoming, creatorId, messageKey, threadKey, index, variant, segmentUrl),
        });
      },
    },
  },
});

async function streamMedia(
  request: Request,
  creatorId: string,
  messageKey: string,
  threadKey: string,
  index: number,
  variant: string,
  segmentUrl: string | null,
): Promise<Response> {
  const sql = await getSql();
  const rows = await sql.query<{ media_json: string | null; from_fan: boolean }>(
    "select media_json, from_fan from of_chat_message where creator_id = $1 and message_key = $2 and thread_key = $3",
    [creatorId, messageKey, threadKey],
  );
  const item = decodeMedia(rows[0]?.media_json ?? null)?.[index];
  if (!item || !rows[0]) return new Response("Enlace caducado, recarga el chat", { status: 410 });
  const decision = mediaPlay({ ...item, full: item.full ?? null }, rows[0].from_fan);
  if (!decision.play) return new Response(decision.notice, { status: decision.notice.includes("bloqueado") ? 403 : 410 });
  const session = await sessionRun(creatorId);
  if (decision.hls && variant === "full") {
    const playlist = await loadPlaylistCached(`${creatorId}\n${decision.url}`, Date.now(), () => readPlaylist(decision.url, session));
    if (!playlist) return new Response("Enlace caducado, recarga el chat", { status: 410 });
    const body = rewritePlaylist(playlist, decision.url, (absolute) => {
      if (!mediaHostAllowed(absolute)) return null;
      const params = new URLSearchParams({ creatorId, threadKey, messageKey, index: String(index), variant: "segment", u: absolute });
      return `/api/chat-media?${params.toString()}`;
    });
    return new Response(body, { headers: { "content-type": "application/vnd.apple.mpegurl", "cache-control": "private, no-store" } });
  }
  let target = decision.url;
  if (variant === "segment") {
    const playlist = await loadPlaylistCached(`${creatorId}\n${decision.url}`, Date.now(), () => readPlaylist(decision.url, session));
    if (!segmentUrl || !decision.hls || !playlistUrls(playlist ?? "", decision.url).includes(segmentUrl)) {
      return new Response("Enlace caducado, recarga el chat", { status: 403 });
    }
    target = segmentUrl;
  } else if (isHlsUrl(decision.url)) {
    return new Response("Enlace caducado, recarga el chat", { status: 410 });
  }
  const opened = await openPlayable(target, request.headers.get("range"), session);
  if (!opened.ok) {
    const notice = opened.reason === "host" || opened.reason === "rango" ? "Sin datos" : "Enlace caducado, recarga el chat";
    return new Response(notice, { status: opened.status });
  }
  return new Response(opened.body, { status: opened.status, headers: opened.headers });
}

async function readPlaylist(url: string, session: SessionRun | null): Promise<string | null> {
  const bytes = await loadPreviewBytes(url, session);
  if (!bytes) return null;
  return new TextDecoder().decode(bytes);
}

async function loadPreview(creatorId: string, messageKey: string, threadKey: string, index: number): Promise<Uint8Array | null> {
  const cache = cachePath(creatorId, messageKey, index);
  const cached = await readFile(cache).catch(() => null);
  if (cached) return cached;
  const sql = await getSql();
  const rows = await sql.query<{ media_json: string | null }>(
    "select media_json from of_chat_message where creator_id = $1 and message_key = $2 and thread_key = $3",
    [creatorId, messageKey, threadKey],
  );
  const preview = decodeMedia(rows[0]?.media_json ?? null)?.[index]?.preview;
  if (!preview) return null;
  const bytes = await loadPreviewBytes(preview, await sessionRun(creatorId));
  if (!bytes) return null;
  await mkdir(path.dirname(cache), { recursive: true });
  await writeFile(cache, bytes);
  const cacheDir = path.join(loadCrmSessionConfig().dataDir, "media-cache");
  if (shouldPruneMediaCache(cacheDir)) await pruneMediaCache(cacheDir).catch(() => undefined);
  return bytes;
}

/**
 * Cuenta con sesión activa: la lectura ocurre dentro de withSession,
 * así context.request usa el proxy y la huella. No se copian cookies.
 */
async function sessionRun(creatorId: string): Promise<SessionRun | null> {
  try {
    const sessions = await getOfSessionManager();
    const account = (await sessions.listAccounts()).find((item) => item.creatorId === creatorId);
    if (!account || account.status !== "active" || !account.hasStorageState) return null;
    return async (task) => {
      try {
        return await sessions.withSession(account.id, (context) => task(playwrightSessionRequest(context.request)));
      } catch {
        return null;
      }
    };
  } catch {
    return null;
  }
}

function cachePath(creatorId: string, messageKey: string, index: number): string {
  const safe = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);
  return path.join(loadCrmSessionConfig().dataDir, "media-cache", safe(creatorId), safe(messageKey), String(index));
}
