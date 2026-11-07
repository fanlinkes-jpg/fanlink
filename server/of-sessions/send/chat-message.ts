import { creatorIdsForChats, WorkspaceAccessError } from "../../../src/lib/access-policy.ts";
import { chatSendGate, publicSendReason, type SendAccount } from "./gate.ts";
import { deliverChatSend, sendLimitFromEnv } from "./deliver.ts";
import { itemSaleBlocked } from "../sync/vault-block.ts";
import type { ReadSql } from "../sync/store.ts";
import { markOutboundAwaiting, markOutboundError, markOutboundSent, recordOutbound } from "../sync/chat-store.ts";

export type SendChatHooks = {
  sql: ReadSql;
  access: { userId: string; role: "owner" | "member"; perms: string[]; creatorIds: string[] };
  account: {
    id: string;
    creatorId: string | null;
    identityHandle: string | null;
    identityUserId: string | null;
    identityState: string | null;
    label: string | null;
  } | null;
  env: NodeJS.ProcessEnv;
  open: () => Promise<{ messageId: string | null; reason: string | null; awaitingId?: boolean }>;
  /** Lo rellena el envío real justo antes de abrir OnlyFans. */
  vaultTitles?: string[];
};

export async function sendChatMessageView(
  userId: string,
  input: { creatorId: string; fanKey: string | null; threadKey: string | null; body: string; priceCents: number | null; vaultTitle?: string | null; vaultItemIds?: string[] },
  hooks?: SendChatHooks,
): Promise<{ sent: boolean; reason: string | null; messageId: string | null }> {
  const prepared = hooks ?? await loadProductionHooks(userId, input);
  const access = prepared.access;
  if (access.role !== "owner" && !access.perms.includes("mensajes")) {
    throw new WorkspaceAccessError("No tienes permiso para escribir.");
  }
  const body = input.body.replace(/\s+/g, " ").trim();
  if (!body) throw new WorkspaceAccessError("Escribe un mensaje.");
  if (!input.threadKey) return { sent: false, reason: "Sin hilo", messageId: null };
  if (input.priceCents != null && input.priceCents > 0 && input.priceCents < 300) {
    return { sent: false, reason: "Mínimo $3 USD o gratis", messageId: null };
  }
  if (!prepared.account) return { sent: false, reason: "Envío real desactivado", messageId: null };
  if (!creatorIdsForChats(access, [...access.creatorIds]).includes(input.creatorId)) {
    return { sent: false, reason: "Sin datos", messageId: null };
  }
  if (prepared.account.identityState === "mismatch") {
    return { sent: false, reason: "Lecturas bloqueadas: la sesión guardada es de otra cuenta.", messageId: null };
  }
  const fields: SendAccount = {
    creatorId: prepared.account.creatorId,
    accountId: prepared.account.id,
    handle: prepared.account.identityHandle,
    userId: prepared.account.identityUserId,
    label: prepared.account.label,
  };
  const gate = chatSendGate(prepared.env.FANLINK_ENABLE_SEND, prepared.env.FANLINK_SEND_ALLOW_ACCOUNTS, fields);
  if (!gate.allowed) return { sent: false, reason: gate.reason, messageId: null };
  const sql = prepared.sql;
  const vaultItemIds = (input.vaultItemIds ?? []).filter((item) => item.trim());
  const { loadSaleContext, noteVaultFanSend, recordOutboundMedia } = await import("../sync/vault-store.ts");
  const loaded = vaultItemIds.length > 0 ? await loadSaleContext(sql, input.creatorId, vaultItemIds) : { sales: [], missing: [] as string[] };
  if (loaded.missing.length > 0 || loaded.sales.some((sale) => itemSaleBlocked(sale))) {
    return { sent: false, reason: "NO VENDER", messageId: null };
  }
  if (prepared.vaultTitles) {
    prepared.vaultTitles.splice(0, prepared.vaultTitles.length, ...loaded.sales.map((sale) => sale.title ?? "").filter((title) => title.trim()));
    if (input.vaultTitle?.trim()) prepared.vaultTitles.push(input.vaultTitle);
  }
  const id = crypto.randomUUID();
  await recordOutbound(sql, {
    id,
    creatorId: input.creatorId,
    threadKey: input.threadKey,
    fanKey: input.fanKey,
    authorId: access.userId,
    body,
    priceCents: input.priceCents,
    createdAt: new Date().toISOString(),
    ofMessageKey: null,
    scheduledAt: null,
  });
  if (vaultItemIds.length > 0) await recordOutboundMedia(sql, id, input.creatorId, vaultItemIds);
  try {
    const result = await deliverChatSend({
      flag: prepared.env.FANLINK_ENABLE_SEND,
      allowlist: prepared.env.FANLINK_SEND_ALLOW_ACCOUNTS,
      perMinute: sendLimitFromEnv(prepared.env),
      account: fields,
      now: () => Date.now(),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      sales: loaded.sales,
      outboundMedia: vaultItemIds.length > 0 ? { sql, outboundId: id } : null,
      open: prepared.open,
    });
    if (result.sent && result.messageId) {
      await markOutboundSent(sql, id, result.messageId);
      if (input.fanKey) {
        for (const itemKey of vaultItemIds) {
          await noteVaultFanSend(sql, {
            id: crypto.randomUUID(),
            creatorId: input.creatorId,
            fanKey: input.fanKey,
            itemKey,
            sentAt: new Date().toISOString(),
            priceCents: input.priceCents,
            authorId: access.userId,
          });
        }
      }
      return { sent: true, reason: null, messageId: result.messageId };
    }
    if (result.awaitingId) {
      await markOutboundAwaiting(sql, id);
      return { sent: false, reason: "Pendiente de confirmar", messageId: null };
    }
    const reason = result.reason ?? "No se envió";
    await markOutboundError(sql, id, reason);
    return { sent: false, reason, messageId: null };
  } catch (error) {
    const reason = publicSendReason(error instanceof Error ? error.message : "No se envió");
    console.info(`[fanlink:send] error motivo=${reason}`);
    await markOutboundError(sql, id, reason);
    return { sent: false, reason, messageId: null };
  }
}

async function loadProductionHooks(
  userId: string,
  input: { creatorId: string; fanKey: string | null; threadKey: string | null; body: string; priceCents: number | null; vaultTitle?: string | null; vaultItemIds?: string[] },
): Promise<SendChatHooks> {
  const { resolveChatSendHooks } = await import("../../../src/lib/of-sessions-runtime.server.ts");
  return resolveChatSendHooks(userId, input);
}
