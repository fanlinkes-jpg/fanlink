import { createFileRoute } from "@tanstack/react-router";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { creatorIdsForChats } from "@/lib/access-policy";
import { DEV_USER_ID, authConfigured, requireUserId } from "@/lib/auth/verify.server";
import { getSql } from "@/lib/db";
import { getOfSessionManager } from "@/lib/of-sessions-runtime.server";
import { ensureStaff } from "@/lib/workspace-store";
import { loadCrmSessionConfig } from "../../../server/of-sessions/config.ts";
import { runMediaTask } from "../../../server/of-sessions/sync/media-gate.ts";
import { mediaHeaders } from "../../../server/of-sessions/sync/media-body.ts";
import { loadPreviewBytes, type SessionRun } from "../../../server/of-sessions/sync/media-load.ts";
import { pruneMediaCache, shouldPruneMediaCache } from "../../../server/of-sessions/sync/media-cache.ts";
import { playwrightSessionRequest } from "../../../server/of-sessions/sync/media-session.ts";
import { canReadVault } from "../../../server/of-sessions/sync/vault-access.ts";

export const Route = createFileRoute("/api/vault-media")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const userId = await requireUserId();
        const localOpen = !authConfigured && userId === DEV_USER_ID;
        const url = new URL(request.url);
        const creatorId = url.searchParams.get("creatorId") ?? "";
        const mediaId = url.searchParams.get("mediaId") ?? "";
        const sql = await getSql();
        const access = await ensureStaff(sql, userId, localOpen);
        if (!creatorId || !mediaId || !canReadVault({ localOpen, role: access.role, perms: access.perms })) {
          return new Response("Sin datos", { status: 404 });
        }
        if (!creatorIdsForChats(access, [creatorId]).includes(creatorId)) return new Response("Sin datos", { status: 404 });
        const cached = await readFile(cachePath(creatorId, mediaId)).catch(() => null);
        if (cached) return mediaResponse(cached);
        const rows = await sql.query<{ preview: string | null }>(
          "select preview from of_vault_item where creator_id = $1 and media_id = $2",
          [creatorId, mediaId],
        );
        const preview = rows[0]?.preview;
        if (!preview) return new Response("Sin datos", { status: 404 });
        const bytes = await loadPreviewBytes(preview, await sessionRun(creatorId));
        if (!bytes) return new Response("Sin datos", { status: 404 });
        const file = cachePath(creatorId, mediaId);
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(file, bytes);
        const cacheDir = path.join(loadCrmSessionConfig().dataDir, "media-cache");
        if (shouldPruneMediaCache(cacheDir)) await pruneMediaCache(cacheDir).catch(() => undefined);
        return mediaResponse(bytes);
      },
    },
  },
});

export function mediaResponse(bytes: Uint8Array): Response {
  return new Response(Buffer.from(bytes), { headers: mediaHeaders(bytes) });
}

async function sessionRun(creatorId: string): Promise<SessionRun | null> {
  try {
    const sessions = await getOfSessionManager();
    const account = (await sessions.listAccounts()).find((item) => item.creatorId === creatorId);
    if (!account || account.status !== "active" || !account.hasStorageState) return null;
    return async (task) => runMediaTask(creatorId, async () => {
      try {
        return await sessions.withSession(account.id, (context) => task(playwrightSessionRequest(context.request)));
      } catch {
        return null;
      }
    });
  } catch {
    return null;
  }
}

function cachePath(creatorId: string, mediaId: string): string {
  const safe = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);
  return path.join(loadCrmSessionConfig().dataDir, "media-cache", "vault", safe(creatorId), safe(mediaId));
}
