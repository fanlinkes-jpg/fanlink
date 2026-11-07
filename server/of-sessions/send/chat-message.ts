import { creatorIdsForChats, WorkspaceAccessError } from "../../../src/lib/access-policy.ts";
import { chatSendGate, publicSendReason, type SendAccount } from "./gate.ts";
import { deliverChatSend, sendLimitFromEnv } from "./deliver.ts";
import { claimSend, releaseSendClaim, sendClaimKey } from "./claim.ts";
import type { VaultSendPiece } from "./vault-piece.ts";
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
  open: () => Promise<{ messageId: string | null; reason: string | null; awaitingId?: boolean; attachedIds?: string[] }>;
  /** Lo rellena el envío real, solo con ids ya comprobados, justo antes de abrir OnlyFans. */
  vaultPieces?: VaultSendPiece[];
};

type SendInput = {
  creatorId: string;
  fanKey: string | null;
  threadKey: string | null;
  body: string;
  priceCents: number | null;
  vaultItemIds?: string[];
};

export async function sendChatMessageView(
  userId: string,
  input: SendInput,
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
  if (clientVaultTitle(input)) return { sent: false, reason: "NO VENDER", messageId: null };
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
  const vaultItemIds = (input.vaultItemIds ?? []).map((item) => item.trim()).filter(Boolean);
  const { noteVaultFanSend, prepareVaultSend, recordOutboundMedia } = await import("../sync/vault-store.ts");
  const planned = await prepareVaultSend(sql, input.creatorId, vaultItemIds);
  if (!planned.ok) return { sent: false, reason: planned.reason, messageId: null };
  const id = crypto.randomUUID();
  const claimKey = sendClaimKey({
    creatorId: input.creatorId,
    threadKey: input.threadKey,
    fanKey: input.fanKey,
    body,
    priceCents: input.priceCents,
    vaultItemIds,
  });
  if (!(await claimSend(sql, claimKey, id))) return { sent: false, reason: "Ya se está enviando", messageId: null };
  prepared.vaultPieces?.splice(0, prepared.vaultPieces.length, ...planned.pieces);
  try {
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
    const result = await deliverChatSend({
      flag: prepared.env.FANLINK_ENABLE_SEND,
      allowlist: prepared.env.FANLINK_SEND_ALLOW_ACCOUNTS,
      perMinute: sendLimitFromEnv(prepared.env),
      account: fields,
      now: () => Date.now(),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      sales: planned.sales,
      outboundMedia: vaultItemIds.length > 0 ? { sql, outboundId: id } : null,
      open: prepared.open,
    });
    if (result.sent && result.messageId) {
      await markOutboundSent(sql, id, result.messageId);
      const confirmed = new Set(result.attachedIds ?? []);
      if (input.fanKey) {
        for (const itemKey of vaultItemIds) {
          if (!confirmed.has(itemKey)) continue;
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
    await releaseSendClaim(sql, claimKey, id);
    return { sent: false, reason, messageId: null };
  } catch (error) {
    const reason = publicSendReason(error instanceof Error ? error.message : "No se envió");
    console.info(`[fanlink:send] error motivo=${reason}`);
    await markOutboundError(sql, id, reason).catch(() => undefined);
    await releaseSendClaim(sql, claimKey, id).catch(() => undefined);
    return { sent: false, reason, messageId: null };
  }
}

/** El navegador no elige la pieza. Un título suelto no se pulsa. */
function clientVaultTitle(input: object): string {
  const value = (input as { vaultTitle?: unknown }).vaultTitle;
  return typeof value === "string" ? value.trim() : "";
}

async function loadProductionHooks(userId: string, input: SendInput): Promise<SendChatHooks> {
  const { resolveChatSendHooks } = await import("../../../src/lib/of-sessions-runtime.server.ts");
  return resolveChatSendHooks(userId, input);
}
