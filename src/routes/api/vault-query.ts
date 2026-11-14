import { createFileRoute } from "@tanstack/react-router";
import { authConfigured, DEV_USER_ID, requireUserId, UnauthorizedError } from "@/lib/auth/verify.server";
import { getSql } from "@/lib/db";
import { getOfSessionManager } from "@/lib/of-sessions-runtime.server";
import { ensureStaff } from "@/lib/workspace-store";
import { handleVaultQuery } from "../../../server/of-sessions/http/vault-http.ts";
import { accountCreatorIds } from "../../../server/of-sessions/http/vault-accounts.ts";
import { fetchSignedVault } from "../../../server/of-sessions/sync/of-chat-api.ts";
import { persistVaultRead } from "../../../server/of-sessions/sync/vault-store.ts";
import { rememberVaultThumbs } from "../../../server/of-sessions/sync/vault-thumbs.ts";
import { openProfileThumbs } from "../../../server/of-sessions/sync/vault-owner.ts";

export const Route = createFileRoute("/api/vault-query")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const userId = await requireUserId();
          const sql = await getSql();
          const access = await ensureStaff(sql, userId, !authConfigured && userId === DEV_USER_ID);
          const creatorIds = await accountCreatorIds(sql);
          const raw = await request.text();
          await refreshVault(sql, raw);
          return handleVaultQuery(new Request(request.url, { method: "POST", headers: { "content-type": "application/json" }, body: raw }), {
            session: async () => ({ userId: access.userId, role: access.role, perms: access.perms, creatorIds }),
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

async function refreshVault(sql: Awaited<ReturnType<typeof getSql>>, raw: string): Promise<void> {
  let creatorId = "";
  try {
    const body = JSON.parse(raw) as { creatorId?: unknown };
    creatorId = typeof body.creatorId === "string" ? body.creatorId : "";
  } catch {
    return;
  }
  if (!creatorId) return;
  try {
    const sessions = await getOfSessionManager();
    const account = (await sessions.listAccounts()).find((item) => item.creatorId === creatorId && item.status === "active" && item.hasStorageState);
    if (!account) return;
    const state = await sessions.readStorageState(account.id);
    const read = await fetchSignedVault(state, { fetch, now: () => Date.now() });
    console.info(`[fanlink:vault] creator=${creatorId} status=${read.status ?? "sin"}`);
    if (read.sessionRejected || read.signatureRejected || read.retryAfterMs > 0) return;
    const saved = await persistVaultRead(sql, creatorId, read.payloads, { listId: "all", offset: 0 });
    console.info(`[fanlink:vault] api medios=${saved.length} fotos=${saved.filter((item) => item.preview).length}`);
    if (saved.length === 0) return;
    await rememberVaultThumbs({
      creatorId,
      items: saved,
      state,
      fetch,
      now: Date.now(),
      refreshPage: async () => {
        const again = await fetchSignedVault(state, { fetch, now: () => Date.now() });
        if (again.sessionRejected || again.signatureRejected || again.retryAfterMs > 0) return saved;
        const next = await persistVaultRead(sql, creatorId, again.payloads, { listId: "all", offset: 0 });
        return next.length > 0 ? next : saved;
      },
      openBrowser: () => openProfileThumbs(sessions, account.id),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "no se pudo leer la bóveda";
    console.info(`[fanlink:vault] api ${message.replace(/https?:\/\/\S+/gi, "").slice(0, 120)}`);
  }
}
