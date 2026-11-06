import { createFileRoute } from "@tanstack/react-router";
import { creatorIdsForChats } from "@/lib/access-policy";
import { DEV_USER_ID, authConfigured, requireUserId } from "@/lib/auth/verify.server";
import { getSql } from "@/lib/db";
import { getOfSessionManager } from "@/lib/of-sessions-runtime.server";
import { ensureStaff } from "@/lib/workspace-store";
import { loadPreviewBytes, type SessionRun } from "../../../server/of-sessions/sync/media-load.ts";
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
        const rows = await sql.query<{ preview: string | null }>(
          "select preview from of_vault_item where creator_id = $1 and media_id = $2",
          [creatorId, mediaId],
        );
        const preview = rows[0]?.preview;
        if (!preview) return new Response("Sin datos", { status: 404 });
        const bytes = await loadPreviewBytes(preview, await sessionRun(creatorId));
        if (!bytes) return new Response("Sin datos", { status: 404 });
        return new Response(Buffer.from(bytes), { headers: { "content-type": "application/octet-stream", "cache-control": "private, max-age=86400" } });
      },
    },
  },
});

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
