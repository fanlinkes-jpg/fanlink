import { createFileRoute } from "@tanstack/react-router";
import { authConfigured, DEV_USER_ID, requireUserId, UnauthorizedError } from "@/lib/auth/verify.server";
import { getSql } from "@/lib/db";
import { getOfSessionManager } from "@/lib/of-sessions-runtime.server";
import { ensureStaff } from "@/lib/workspace-store";
import { handleVaultMedia } from "../../../server/of-sessions/http/vault-http.ts";
import { readSessionMediaBytes, readSessionMediaResult } from "../../../server/of-sessions/sync/media-bytes.ts";
import { accountCreatorIds } from "../../../server/of-sessions/http/vault-accounts.ts";
import { fetchSignedVault } from "../../../server/of-sessions/sync/of-chat-api.ts";
import { mediaHostAllowed } from "../../../server/of-sessions/sync/history.ts";
import { parseVaultBundle } from "../../../server/of-sessions/sync/vault-model.ts";
import { loadFreshPreview, shareRefresh, signedUrlExpired } from "../../../server/of-sessions/sync/vault-thumbs.ts";

export const Route = createFileRoute("/api/vault-media")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const userId = await requireUserId();
          const sql = await getSql();
          const access = await ensureStaff(sql, userId, !authConfigured && userId === DEV_USER_ID);
          const creatorIds = await accountCreatorIds(sql);
          const url = new URL(request.url);
          const creatorId = url.searchParams.get("creatorId") ?? "";
          const mediaId = url.searchParams.get("mediaId") ?? "";
          const variant = url.searchParams.get("variant") === "full" ? "full" : "preview";
          return handleVaultMedia(request, {
            session: async () => ({ userId: access.userId, role: access.role, perms: access.perms, creatorIds }),
            findPreview: async (creator, id, wanted) => {
              const rows = await sql.query<{ preview: string | null; full_url: string | null }>(
                "select preview, full_url from of_vault_item where creator_id = $1 and item_key = $2",
                [creator, id],
              );
              if (wanted === "full") return rows[0]?.full_url ?? null;
              return rows[0]?.preview ?? null;
            },
            fetchBytes: (target, range) => {
              if (variant === "full" || range) return readSessionMediaBytes(creatorId, target, range);
              return loadFreshPreview({
                creatorId,
                mediaId,
                url: target,
                read: (next) => readSessionMediaResult(creatorId, next),
                reload: () => reloadPreview(sql, creatorId, mediaId),
              });
            },
            log: (line) => {
              console.info(line);
            },
          });
        } catch (error) {
          if (error instanceof UnauthorizedError) return new Response("Unauthorized", { status: 401 });
          throw error;
        }
      },
    },
  },
});

async function reloadPreview(
  sql: Awaited<ReturnType<typeof getSql>>,
  creatorId: string,
  mediaId: string,
): Promise<string | null> {
  const items = await shareRefresh(creatorId, async () => {
    const sessions = await getOfSessionManager();
    const account = (await sessions.listAccounts()).find((item) => item.creatorId === creatorId && item.status === "active" && item.hasStorageState);
    if (!account) return [];
    const payloads = await fetchSignedVault(await sessions.readStorageState(account.id), { fetch, now: () => Date.now() });
    return payloads.flatMap((payload) => parseVaultBundle(payload).items);
  });
  const preview = items.find((item) => item.id === mediaId)?.preview ?? null;
  if (!preview || !mediaHostAllowed(preview) || signedUrlExpired(preview, Date.now())) return null;
  await sql.query(
    "update of_vault_item set preview = $3 where creator_id = $1 and item_key = $2",
    [creatorId, mediaId, preview],
  );
  return preview;
}
