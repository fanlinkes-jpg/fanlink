import { createFileRoute } from "@tanstack/react-router";
import { authConfigured, DEV_USER_ID, requireUserId, UnauthorizedError } from "@/lib/auth/verify.server";
import { getSql } from "@/lib/db";
import { getOfSessionManager } from "@/lib/of-sessions-runtime.server";
import { ensureStaff } from "@/lib/workspace-store";
import { handleVaultMedia } from "../../../server/of-sessions/http/vault-http.ts";
import { readSessionMediaBytes, readSessionMediaResult } from "../../../server/of-sessions/sync/media-bytes.ts";
import { accountCreatorIds } from "../../../server/of-sessions/http/vault-accounts.ts";
import { fetchSignedVault } from "../../../server/of-sessions/sync/of-chat-api.ts";
import { parseVaultBundle } from "../../../server/of-sessions/sync/vault-model.ts";
import { loadFreshPreview, normalizeVaultOffset, reloadVaultPreview } from "../../../server/of-sessions/sync/vault-thumbs.ts";
import { openProfileThumbs } from "../../../server/of-sessions/sync/vault-owner.ts";
import { saveVaultPreview, storedVaultPage } from "../../../server/of-sessions/sync/vault-store.ts";

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
          const page = await thumbPage(sql, creatorId, mediaId, url);
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
                reload: () => reloadPreview(sql, creatorId, mediaId, page.listId, page.offset),
                openBrowser: () => profileThumbs(creatorId),
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

async function thumbPage(
  sql: Awaited<ReturnType<typeof getSql>>,
  creatorId: string,
  mediaId: string,
  url: URL,
): Promise<{ listId: string; offset: number }> {
  const requestedList = url.searchParams.get("list");
  const requestedOffset = url.searchParams.get("offset");
  if (requestedList != null || requestedOffset != null) {
    return {
      listId: requestedList?.trim() || "all",
      offset: normalizeVaultOffset(Number(requestedOffset ?? "0")),
    };
  }
  const stored = await storedVaultPage(sql, creatorId, mediaId);
  return stored ?? { listId: "all", offset: 0 };
}

async function reloadPreview(
  sql: Awaited<ReturnType<typeof getSql>>,
  creatorId: string,
  mediaId: string,
  listId: string,
  offset: number,
): Promise<string | null> {
  return reloadVaultPreview({
    creatorId,
    mediaId,
    listId,
    offset,
    loadPage: async (list, skip) => {
      const sessions = await getOfSessionManager();
      const account = (await sessions.listAccounts()).find((item) => item.creatorId === creatorId && item.status === "active" && item.hasStorageState);
      if (!account) return [];
      const read = await fetchSignedVault(await sessions.readStorageState(account.id), { fetch, now: () => Date.now() }, list, skip);
      if (read.sessionRejected || read.signatureRejected || read.retryAfterMs > 0) return [];
      return read.payloads.flatMap((payload) => parseVaultBundle(payload).items);
    },
    savePreview: (preview) => saveVaultPreview(sql, creatorId, mediaId, preview, { listId, offset }),
  });
}

async function profileThumbs(creatorId: string) {
  const sessions = await getOfSessionManager();
  const account = (await sessions.listAccounts()).find((item) => item.creatorId === creatorId && item.status === "active" && item.hasStorageState);
  if (!account) return null;
  return openProfileThumbs(sessions, account.id);
}
