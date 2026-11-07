import { createFileRoute } from "@tanstack/react-router";
import { authConfigured, DEV_USER_ID, requireUserId, UnauthorizedError } from "@/lib/auth/verify.server";
import { getSql } from "@/lib/db";
import { ensureStaff } from "@/lib/workspace-store";
import { handleChatMedia } from "../../../server/of-sessions/http/vault-http.ts";
import { readSessionMediaBytes } from "../../../server/of-sessions/sync/media-bytes.ts";
import { decodeMedia } from "../../../server/of-sessions/sync/history.ts";

export const Route = createFileRoute("/api/chat-media")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const userId = await requireUserId();
          const sql = await getSql();
          const access = await ensureStaff(sql, userId, !authConfigured && userId === DEV_USER_ID);
          const creatorId = new URL(request.url).searchParams.get("creatorId") ?? "";
          return handleChatMedia(request, {
            session: async () => ({ userId: access.userId, role: access.role, perms: access.perms }),
            findMedia: async (creator, threadKey, messageKey, index) => {
              const rows = await sql.query<{ media_json: string | null }>(
                "select media_json from of_chat_message where creator_id = $1 and thread_key = $2 and message_key = $3",
                [creator, threadKey, messageKey],
              );
              const item = decodeMedia(rows[0]?.media_json ?? null)?.[index];
              return { url: item?.full ?? item?.preview ?? null };
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
