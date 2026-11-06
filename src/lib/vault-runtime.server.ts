import type { Page } from "playwright";
import { DEV_USER_ID, authConfigured } from "@/lib/auth/verify.server";
import { canSeeAgencyEarnings, creatorIdsForChats } from "@/lib/access-policy";
import { getSql } from "@/lib/db";
import { getOfSessionManager } from "@/lib/of-sessions-runtime.server";
import { ensureStaff } from "@/lib/workspace-store";
import { onlyFansSite } from "../../server/of-sessions/sessions/onlyfans.ts";
import { canReadVault } from "../../server/of-sessions/sync/vault-access.ts";
import { listVault, saveVaultRead, sendsForFan, vaultCursor } from "../../server/of-sessions/sync/vault-store.ts";
import { captureVault, continueVault, priceRuleFromEnv, vaultForBrowser, vaultForRole, vaultPaceMs, type VaultPageLike, type VaultSend } from "../../server/of-sessions/sync/vault.ts";

export async function listVaultView(userId: string, creatorId: string, fanKey: string | null) {
  const access = await accessFor(userId);
  const canSeeRevenue = canSeeAgencyEarnings(access);
  if (!canReadVault({ localOpen: access.devMode, role: access.role, perms: access.perms })) {
    return { items: [], folders: [], sends: [], canSeeRevenue, priceRule: priceRuleFromEnv(process.env.FANLINK_PRICE_RULE), notice: "Sin datos" };
  }
  if (!creatorId || !creatorIdsForChats(access, [creatorId]).includes(creatorId)) {
    return { items: [], folders: [], sends: [], canSeeRevenue, priceRule: priceRuleFromEnv(process.env.FANLINK_PRICE_RULE), notice: "Sin datos" };
  }
  const sql = await getSql();
  const stored = await listVault(sql, creatorId);
  const sends = (await sendsForFan(sql, creatorId, fanKey)).map((send) => hideSendPrice(send, canSeeRevenue));
  return {
    items: stored.items.map((item) => vaultForRole(vaultForBrowser(item), canSeeRevenue)),
    folders: stored.folders,
    sends,
    canSeeRevenue,
    priceRule: priceRuleFromEnv(process.env.FANLINK_PRICE_RULE),
    notice: stored.items.length === 0 && stored.folders.length === 0 ? "Sin datos" : null,
  };
}

function hideSendPrice(send: VaultSend, canSeeRevenue: boolean): VaultSend {
  if (canSeeRevenue) return send;
  return { ...send, priceCents: null };
}

export async function syncVaultView(userId: string, creatorId: string, mode: "sync" | "continue") {
  const access = await accessFor(userId);
  if (access.role !== "owner" && !access.devMode) {
    return { notice: "Solo la dueña puede sincronizar la bóveda." };
  }
  if (!creatorId) return { notice: "Sin datos" };
  const sessions = await getOfSessionManager();
  const account = (await sessions.listAccounts()).find((item) => item.creatorId === creatorId);
  if (!account || account.status !== "active" || !account.hasStorageState) return { notice: "Sin datos" };
  const sql = await getSql();
  const cursor = await vaultCursor(sql, creatorId);
  const decision = continueVault(cursor != null, mode);
  if (!decision.go) return { notice: decision.notice };
  const read = await sessions.withSession(account.id, async (context) => {
    const page = await context.newPage();
    try {
      return await captureVault(asVaultPage(page), onlyFansSite.origin, mode, {
        hasCursor: cursor != null,
        paceMs: vaultPaceMs(process.env.FANLINK_VAULT_PACE_MS),
      });
    } finally {
      await page.close().catch(() => undefined);
    }
  });
  await saveVaultRead(sql, creatorId, read);
  return { notice: read.notice };
}

async function accessFor(userId: string) {
  const sql = await getSql();
  return ensureStaff(sql, userId, !authConfigured && userId === DEV_USER_ID);
}

function asVaultPage(page: Page): VaultPageLike {
  return {
    goto: async (url) => {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    },
    on: (event, handler) => page.on(event, handler),
    off: (event, handler) => page.off(event, handler),
    scroll: () => page.mouse.wheel(0, 700),
  };
}
