import { creatorIdsForChats, WorkspaceAccessError } from "../../../src/lib/access-policy.ts";
import { chatSendGate, publicSendReason, type SendAccount } from "./gate.ts";
import { deliverChatSend, sendLimitFromEnv } from "./deliver.ts";
import { claimSend, releaseSendClaim, sendClaimKey } from "./claim.ts";
import type { VaultSendPiece } from "./vault-piece.ts";
import type { ReadSql } from "../sync/store.ts";
import {
  discardOutboundError,
  expireStuckPending,
  insertOutboundOnce,
  markOutboundAwaiting,
  markOutboundError,
  markOutboundSent,
  pulseOutboundLease,
  readOutboundClaim,
  reopenOutboundError,
  reviewAwaitingOutbound,
  SEND_LEASE_MS,
  type OutboundClaimRow,
} from "../sync/chat-store.ts";

const CLIENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SEND_PROCESS_ID = crypto.randomUUID();

/** Motivos que salen antes de pulsar Send. Cualquier otro, con el navegador abierto, no se reintenta. */
const BEFORE_CLICK = new Set([
  "no se abrió el hilo",
  "OnlyFans pide iniciar sesión: pulsa Reconectar",
  "no está la caja del chat",
  "No está el precio nativo",
  "no está el botón Send",
  "No se pudo adjuntar la pieza",
]);

export function beforeSendClick(reason: string | null): boolean {
  return BEFORE_CLICK.has((reason ?? "").trim());
}

/** Late mientras el envío sigue vivo, también en la espera del cupo por minuto. */
function startLease(sql: SendChatHooks["sql"], id: string, claimKey: string): () => void {
  const beat = () => {
    void pulseOutboundLease(sql, id, SEND_PROCESS_ID, claimKey).catch(() => undefined);
  };
  beat();
  const timer = setInterval(beat, Math.max(1_000, Math.floor(SEND_LEASE_MS / 3)));
  timer.unref?.();
  return () => clearInterval(timer);
}

export class OutboundClaimError extends Error {
  readonly status: 403 | 409;
  constructor(status: 403 | 409) {
    super(status === 403 ? "No es tuyo" : "No se puede reenviar");
    this.name = "OutboundClaimError";
    this.status = status;
  }
}

/** Vacío es «sin id». Cualquier otra cosa que no sea un uuid se rechaza. */
export function parseClientId(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== "string") throw new WorkspaceAccessError("clientId no válido");
  const id = value.trim();
  if (!id) return null;
  if (!CLIENT_ID.test(id)) throw new WorkspaceAccessError("clientId no válido");
  return id.toLowerCase();
}

/** Enviado, descartado o pendiente de confirmar: no se vuelve a mandar. */
export function sealedOutbound(row: Pick<OutboundClaimRow, "status" | "errorReason" | "ofMessageKey" | "matchedMessageKey">): boolean {
  if (row.status === "sent" || row.status === "discarded") return true;
  if (row.ofMessageKey || row.matchedMessageKey) return true;
  if (row.errorReason === "Pendiente de confirmar") return true;
  return false;
}

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
  tagHandle?: string | null;
  clientId?: string | null;
};

export async function sendChatMessageView(
  userId: string,
  input: SendInput,
  hooks?: SendChatHooks,
): Promise<{ sent: boolean; reason: string | null; messageId: string | null }> {
  const clientId = parseClientId(input.clientId);
  const prepared = hooks ?? await loadProductionHooks(userId, input);
  const access = prepared.access;
  if (access.role !== "owner" && !access.perms.includes("mensajes")) {
    throw new WorkspaceAccessError("No tienes permiso para escribir.");
  }
  const typedBody = input.body.replace(/\s+/g, " ").trim();
  if (!typedBody) throw new WorkspaceAccessError("Escribe un mensaje.");
  if (!input.threadKey) return { sent: false, reason: "Sin hilo", messageId: null };
  const sql = prepared.sql;
  await expireStuckPending(sql);
  const replay = await replayOf(sql, clientId, access.userId, input.creatorId, input.threadKey);
  if (replay === "busy") return { sent: false, reason: "Ya se está enviando", messageId: null };
  const body = replay ? replay.body : typedBody;
  const priceCents = replay ? replay.priceCents : input.priceCents;
  const fanKey = replay ? replay.fanKey : input.fanKey;
  const creatorId = replay ? replay.creatorId : input.creatorId;
  const threadKey = replay ? (replay.threadKey ?? input.threadKey) : input.threadKey;
  if (priceCents != null && priceCents > 0 && priceCents < 300) {
    return { sent: false, reason: "Mínimo $3 USD o gratis", messageId: null };
  }
  if (clientVaultTitle(input)) return { sent: false, reason: "NO VENDER", messageId: null };
  if (!prepared.account) return { sent: false, reason: "Envío real desactivado", messageId: null };
  if (!creatorIdsForChats(access, [...access.creatorIds]).includes(creatorId)) {
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
  const { noteVaultFanSend, prepareVaultSend, recordOutboundMedia, listOutboundMediaIds } = await import("../sync/vault-store.ts");
  const vaultItemIds = replay
    ? await listOutboundMediaIds(sql, replay.id)
    : (input.vaultItemIds ?? []).map((item) => item.trim()).filter(Boolean);
  const planned = await prepareVaultSend(sql, creatorId, vaultItemIds);
  if (!planned.ok) return { sent: false, reason: planned.reason, messageId: null };
  const id = clientId ?? crypto.randomUUID();
  const claimKey = sendClaimKey({
    authorId: access.userId,
    creatorId,
    threadKey,
    fanKey,
    body,
    priceCents,
    vaultItemIds,
  });
  if (replay && !(await reopenOutboundError(sql, replay.id, access.userId, creatorId, threadKey))) {
    throw new OutboundClaimError(409);
  }
  if (!(await claimSend(sql, claimKey, id))) {
    if (replay) await markOutboundError(sql, id, "Ya se está enviando");
    return { sent: false, reason: "Ya se está enviando", messageId: null };
  }
  prepared.vaultPieces?.splice(0, prepared.vaultPieces.length, ...planned.pieces);
  let browserOpened = false;
  let confirmedId: string | null = null;
  let stopLease: () => void = () => undefined;
  try {
    if (!replay) {
      const inserted = await insertOutboundOnce(sql, {
        id,
        creatorId,
        threadKey,
        fanKey,
        authorId: access.userId,
        body,
        priceCents,
        createdAt: new Date().toISOString(),
        ofMessageKey: null,
        scheduledAt: null,
      });
      if (!inserted) {
        await releaseSendClaim(sql, claimKey, id);
        await rejectForeign(sql, id, access.userId, creatorId, threadKey);
        return { sent: false, reason: "Ya se está enviando", messageId: null };
      }
      if (vaultItemIds.length > 0) await recordOutboundMedia(sql, id, creatorId, vaultItemIds);
    }
    stopLease = startLease(sql, id, claimKey);
    const result = await deliverChatSend({
      flag: prepared.env.FANLINK_ENABLE_SEND,
      allowlist: prepared.env.FANLINK_SEND_ALLOW_ACCOUNTS,
      perMinute: sendLimitFromEnv(prepared.env),
      account: fields,
      now: () => Date.now(),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      sales: planned.sales,
      outboundMedia: vaultItemIds.length > 0 ? { sql, outboundId: id } : null,
      open: async () => {
        browserOpened = true;
        return prepared.open();
      },
    });
    if (result.opened) browserOpened = true;
    if (result.sent && result.messageId) {
      await markOutboundSent(sql, id, result.messageId);
      confirmedId = result.messageId;
      const confirmed = new Set(result.attachedIds ?? []);
      if (fanKey) {
        for (const itemKey of vaultItemIds) {
          if (!confirmed.has(itemKey)) continue;
          await noteVaultFanSend(sql, {
            id: crypto.randomUUID(),
            creatorId,
            fanKey,
            itemKey,
            sentAt: new Date().toISOString(),
            priceCents,
            authorId: access.userId,
          });
        }
      }
      return { sent: true, reason: null, messageId: result.messageId };
    }
    if (result.awaitingId || (result.opened && !beforeSendClick(result.reason))) {
      await markOutboundAwaiting(sql, id);
      return { sent: false, reason: "Pendiente de confirmar", messageId: null };
    }
    const reason = result.reason ?? "No se envió";
    await markOutboundError(sql, id, reason);
    await releaseSendClaim(sql, claimKey, id);
    return { sent: false, reason, messageId: null };
  } catch (error) {
    if (error instanceof OutboundClaimError) throw error;
    if (confirmedId) return { sent: true, reason: null, messageId: confirmedId };
    if (browserOpened) {
      await markOutboundAwaiting(sql, id).catch(() => undefined);
      return { sent: false, reason: "Pendiente de confirmar", messageId: null };
    }
    const reason = publicSendReason(error instanceof Error ? error.message : "No se envió");
    console.info(`[fanlink:send] error motivo=${reason}`);
    await markOutboundError(sql, id, reason).catch(() => undefined);
    await releaseSendClaim(sql, claimKey, id).catch(() => undefined);
    return { sent: false, reason, messageId: null };
  } finally {
    stopLease();
  }
}

export async function discardOutboundView(
  input: { clientId: string },
  hooks: { sql: ReadSql; access: SendChatHooks["access"] },
): Promise<{ ok: true }> {
  const clientId = parseClientId(input.clientId);
  if (!clientId) throw new WorkspaceAccessError("clientId no válido");
  const access = hooks.access;
  if (access.role !== "owner" && !access.perms.includes("mensajes")) {
    throw new WorkspaceAccessError("No tienes permiso para escribir.");
  }
  await expireStuckPending(hooks.sql);
  const row = await readOutboundClaim(hooks.sql, clientId);
  if (!row) return { ok: true };
  if (row.authorId !== access.userId) throw new OutboundClaimError(403);
  if (row.status !== "error" || sealedOutbound(row)) throw new OutboundClaimError(409);
  const done = await discardOutboundError(hooks.sql, clientId, access.userId);
  if (!done) throw new OutboundClaimError(409);
  return { ok: true };
}

/** La dueña cierra un «Pendiente de confirmar» sin volver a enviarlo. */
export async function reviewAwaitingView(
  input: { clientId: string },
  hooks: { sql: ReadSql; access: SendChatHooks["access"] },
): Promise<{ ok: true }> {
  if (hooks.access.role !== "owner") throw new WorkspaceAccessError("No tienes permiso para escribir.");
  const clientId = parseClientId(input.clientId);
  if (!clientId) throw new WorkspaceAccessError("clientId no válido");
  const done = await reviewAwaitingOutbound(hooks.sql, clientId);
  if (!done) throw new OutboundClaimError(409);
  return { ok: true };
}

/**
 * La fila del clientId, si hay que reintentarla.
 * Otro dueño, otra creadora, otro hilo, enviado o pendiente de confirmar: 403/409 sin datos de la fila.
 */
async function replayOf(
  sql: ReadSql,
  clientId: string | null,
  authorId: string,
  creatorId: string,
  threadKey: string,
): Promise<OutboundClaimRow | "busy" | null> {
  if (!clientId) return null;
  const row = await readOutboundClaim(sql, clientId);
  if (!row) return null;
  if (row.authorId !== authorId) throw new OutboundClaimError(403);
  if (row.creatorId !== creatorId || (row.threadKey ?? "") !== threadKey) throw new OutboundClaimError(409);
  if (sealedOutbound(row)) throw new OutboundClaimError(409);
  if (row.status !== "error") return "busy";
  return row;
}

async function rejectForeign(sql: ReadSql, id: string, authorId: string, creatorId: string, threadKey: string): Promise<void> {
  const row = await readOutboundClaim(sql, id);
  if (!row) return;
  if (row.authorId !== authorId) throw new OutboundClaimError(403);
  if (row.creatorId !== creatorId || (row.threadKey ?? "") !== threadKey || sealedOutbound(row)) {
    throw new OutboundClaimError(409);
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
