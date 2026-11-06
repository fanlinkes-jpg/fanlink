import { chatSendGate, createSendLimiter, publicSendReason, sendPerMinute, type SendAccount } from "./gate.ts";

export type SendAttempt = { messageId: string | null; reason: string | null; awaitingId?: boolean };

export type DeliverInput = {
  flag: string | undefined;
  allowlist: string | undefined;
  perMinute: number;
  account: SendAccount;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  open: () => Promise<SendAttempt>;
  limiter?: ReturnType<typeof createSendLimiter>;
};

const sharedLimiter = createSendLimiter();

/** Una cuenta a la vez. Si el gate no deja, no abre el navegador y no reintenta. */
export async function deliverChatSend(input: DeliverInput): Promise<{ sent: boolean; opened: boolean; messageId: string | null; reason: string | null; awaitingId?: boolean }> {
  const gate = chatSendGate(input.flag, input.allowlist, input.account);
  if (!gate.allowed) return { sent: false, opened: false, messageId: null, reason: gate.reason };
  const accountId = input.account.accountId ?? input.account.creatorId ?? "cuenta";
  let opened = false;
  const limiter = input.limiter ?? sharedLimiter;
  const attempt = await limiter.run(accountId, async () => {
    opened = true;
    return input.open();
  }, { perMinute: input.perMinute, now: input.now, sleep: input.sleep });
  if (attempt.messageId) return { sent: true, opened, messageId: attempt.messageId, reason: null };
  if (attempt.awaitingId) return { sent: false, opened, messageId: null, reason: null, awaitingId: true };
  return { sent: false, opened, messageId: null, reason: publicSendReason(attempt.reason ?? "No se envió") };
}

export function sendLimitFromEnv(env: NodeJS.ProcessEnv = process.env): number {
  return sendPerMinute(env.FANLINK_SEND_PER_MINUTE);
}
