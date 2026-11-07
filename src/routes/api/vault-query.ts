import { createFileRoute } from "@tanstack/react-router";
import { authConfigured, DEV_USER_ID, requireUserId, UnauthorizedError } from "@/lib/auth/verify.server";
import { getSql } from "@/lib/db";
import { ensureStaff } from "@/lib/workspace-store";
import { handleVaultQuery } from "../../../server/of-sessions/http/vault-http.ts";

export const Route = createFileRoute("/api/vault-query")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const userId = await requireUserId();
          const sql = await getSql();
          const access = await ensureStaff(sql, userId, !authConfigured && userId === DEV_USER_ID);
          return handleVaultQuery(request, {
            session: async () => ({ userId: access.userId, role: access.role, perms: access.perms }),
            sql,
          });
        } catch (error) {
          if (error instanceof UnauthorizedError) return new Response("Unauthorized", { status: 401 });
          throw error;
        }
      },
    },
  },
});
