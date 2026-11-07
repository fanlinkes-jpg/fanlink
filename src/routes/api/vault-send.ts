import { createFileRoute } from "@tanstack/react-router";
import { authConfigured, DEV_USER_ID, requireUserId, UnauthorizedError } from "@/lib/auth/verify.server";
import { getSql } from "@/lib/db";
import { ensureStaff } from "@/lib/workspace-store";
import { handleVaultSend } from "../../../server/of-sessions/http/vault-http.ts";

export const Route = createFileRoute("/api/vault-send")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const userId = await requireUserId();
          const sql = await getSql();
          const access = await ensureStaff(sql, userId, !authConfigured && userId === DEV_USER_ID);
          return handleVaultSend(request, {
            session: async () => ({ userId: access.userId, role: access.role, perms: access.perms }),
            sql,
            env: {
              FANLINK_ENABLE_SEND: process.env.FANLINK_ENABLE_SEND,
              FANLINK_ENABLE_MASS_SEND: process.env.FANLINK_ENABLE_MASS_SEND,
              FANLINK_SEND_ALLOW_ACCOUNTS: process.env.FANLINK_SEND_ALLOW_ACCOUNTS,
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
