import { authConfigured, DEV_USER_ID } from "@/lib/auth/verify.server";
import { getSql } from "@/lib/db";
import { ensureStaff } from "@/lib/workspace-store";
import { queryVaultForActor, type VaultMirrorResult } from "../../server/of-sessions/sync/vault-query.ts";

export async function queryVaultMirrorView(userId: string, body: unknown): Promise<VaultMirrorResult> {
  const sql = await getSql();
  const access = await ensureStaff(sql, userId, !authConfigured && userId === DEV_USER_ID);
  const result = await queryVaultForActor(sql, { userId: access.userId, role: access.role, perms: access.perms }, body);
  return result.payload;
}
