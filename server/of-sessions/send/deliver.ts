import { deliverIfNoMedia } from "./media-gate.ts";
import { chatSendGate, createSendLimiter, publicSendReason, sendPerMinute, sharedSendLimiter, type SendAccount } from "./gate.ts";
import { itemSaleBlocked, type SaleFolder } from "../sync/vault-block.ts";
import type { ReadSql } from "../sync/store.ts";

export type SendAttempt = { messageId: string | null; reason: string | null; awaitingId?: boolean; attachedIds?: string[] };

export type DeliverSale = {
  folderId: string | null;
  folderName: string | null;
  title: string | null;
  folders: readonly SaleFolder[];
};

export type DeliverInput = {
  flag: string | undefined;
  allowlist: string | undefined;
  perMinute: number;
  account: SendAccount;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  open: () => Promise<SendAttempt>;
  limiter?: ReturnType<typeof createSendLimiter>;
  /** Carpetas de la pieza. Si alguna es NO VENDER, no se abre el navegador. */
  sales?: readonly DeliverSale[];
  /** Si el borrador tiene medios, deliverIfNoMedia impide abrir el envío. */
  outboundMedia?: { sql: ReadSql; outboundId: string } | null;
};

/** Una cuenta a la vez. Si el gate, NO VENDER o un medio no dejan, no abre el navegador y no reintenta. */
export async function deliverChatSend(input: DeliverInput): Promise<{ sent: boolean; opened: boolean; messageId: string | null; reason: string | null; awaitingId?: boolean; attachedIds: string[] }> {
  const gate = chatSendGate(input.flag, input.allowlist, input.account);
  if (!gate.allowed) return { sent: false, opened: false, messageId: null, reason: gate.reason, attachedIds: [] };
  if (input.sales?.some((sale) => itemSaleBlocked(sale))) {
    return { sent: false, opened: false, messageId: null, reason: "NO VENDER", attachedIds: [] };
  }
  const accountId = input.account.accountId ?? input.account.creatorId ?? "cuenta";
  const limiter = input.limiter ?? sharedSendLimiter;
  const runOpen = async () => limiter.run(accountId, async () => input.open(), {
    perMinute: input.perMinute,
    now: input.now,
    sleep: input.sleep,
  });
  if (input.outboundMedia) {
    let opened = false;
    let attempt: SendAttempt | null = null;
    const media = await deliverIfNoMedia(input.outboundMedia.sql, input.outboundMedia.outboundId, async () => {
      opened = true;
      attempt = await runOpen();
    }, true);
    if (!media.sent || !attempt) {
      return { sent: false, opened: false, messageId: null, reason: media.reason ?? "El envío de medios no existe", attachedIds: [] };
    }
    return finish(opened, attempt);
  }
  let opened = false;
  const attempt = await limiter.run(accountId, async () => {
    opened = true;
    return input.open();
  }, { perMinute: input.perMinute, now: input.now, sleep: input.sleep });
  return finish(opened, attempt);
}

function finish(opened: boolean, attempt: SendAttempt): { sent: boolean; opened: boolean; messageId: string | null; reason: string | null; awaitingId?: boolean; attachedIds: string[] } {
  const attachedIds = attempt.attachedIds ?? [];
  if (attempt.messageId) return { sent: true, opened, messageId: attempt.messageId, reason: null, attachedIds };
  if (attempt.awaitingId) return { sent: false, opened, messageId: null, reason: null, awaitingId: true, attachedIds };
  return { sent: false, opened, messageId: null, reason: publicSendReason(attempt.reason ?? "No se envió"), attachedIds };
}

export function sendLimitFromEnv(env: NodeJS.ProcessEnv = process.env): number {
  return sendPerMinute(env.FANLINK_SEND_PER_MINUTE);
}
