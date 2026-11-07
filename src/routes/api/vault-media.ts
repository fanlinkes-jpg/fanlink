import { createFileRoute } from "@tanstack/react-router";
import { authConfigured, DEV_USER_ID, requireUserId, UnauthorizedError } from "@/lib/auth/verify.server";
import { getSql } from "@/lib/db";
import { ensureStaff } from "@/lib/workspace-store";
import { handleVaultMedia } from "../../../server/of-sessions/http/vault-http.ts";
import { readSessionMediaBytes } from "../../../server/of-sessions/sync/media-bytes.ts";

export const Route = createFileRoute("/api/vault-media")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const userId = await requireUserId();
          const sql = await getSql();
          const access = await ensureStaff(sql, userId, !authConfigured && userId === DEV_USER_ID);
          const creatorId = new URL(request.url).searchParams.get("creatorId") ?? "";
          return handleVaultMedia(request, {
            session: async () => ({ userId: access.userId, role: access.role, perms: access.perms }),
            findPreview: async (creator, mediaId) => {
              const rows = await sql.query<{ preview: string | null }>(
                "select preview from of_vault_item where creator_id = $1 and item_key = $2",
                [creator, mediaId],
              );
              return rows[0]?.preview ?? null;
            },
            fetchBytes: (target) => readSessionMediaBytes(creatorId, target),
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
