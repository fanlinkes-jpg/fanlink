import type { ChatMessage } from "../sync/chats.ts";

export type SendAccount = {
  creatorId: string | null;
  accountId: string | null;
  handle: string | null;
  userId: string | null;
  label: string | null;
};

/** Ids y handles separados por coma, espacio o punto y coma. La @ no cuenta. */
export function allowTokens(raw: string | undefined): string[] {
  if (!raw) return [];
  return [...new Set(raw.split(/[,;\s]+/).map(normalizeToken).filter(Boolean))];
}

export function accountOnAllowlist(raw: string | undefined, account: SendAccount): boolean {
  const tokens = allowTokens(raw);
  if (tokens.length === 0) return false;
  const values = [account.creatorId, account.accountId, account.handle, account.userId, account.label]
    .map((value) => normalizeToken(value ?? ""));
  return tokens.some((token) => values.includes(token));
}

/**
 * El envío real solo sale si el flag está encendido y la cuenta está en la lista.
 * El resto se queda apagado aunque la petición llegue al servidor.
 */
export function chatSendGate(
  flag: string | undefined,
  allowlist: string | undefined,
  account: SendAccount,
): { allowed: boolean; reason: string } {
  if (flag !== "true") return { allowed: false, reason: "Envío real desactivado" };
  if (allowTokens(allowlist).length === 0) return { allowed: false, reason: "Envío real desactivado" };
  if (!accountOnAllowlist(allowlist, account)) return { allowed: false, reason: "Esta cuenta no puede enviar." };
  return { allowed: true, reason: "" };
}

export function sendPerMinute(raw: string | undefined): number {
  if (raw == null || raw.trim() === "") return 4;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 30) return 4;
  return value;
}

/** Espera hasta que quepa otro envío en el último minuto. No reintenta un fallo. */
export function sendPace(recentMs: number[], now: number, perMinute: number): { waitMs: number; recent: number[] } {
  const recent = recentMs.filter((at) => now - at < 60_000).sort((left, right) => left - right);
  if (perMinute < 1 || recent.length < perMinute) return { waitMs: 0, recent };
  const oldest = recent[0] ?? now;
  return { waitMs: Math.max(0, 60_000 - (now - oldest)), recent };
}

export function humanTypeDelay(random: () => number): number {
  const roll = random();
  const base = 40 + Math.floor(random() * 80);
  return roll < 0.1 ? base + 160 : base;
}

export function confirmedOwnMessage(
  messages: ChatMessage[],
  body: string,
  priceCents: number | null,
): { messageId: string } | null {
  const text = normalizeBody(body);
  if (!text) return null;
  const hit = messages.find((message) => {
    if (message.fromFan) return false;
    if (normalizeBody(message.body) !== text) return false;
    if (priceCents != null && priceCents > 0 && message.priceCents !== priceCents) return false;
    return true;
  });
  return hit ? { messageId: hit.messageKey } : null;
}

export function publicSendReason(reason: string): string {
  const text = reason.replace(/https?:\/\/\S+/g, "").replace(/\s+/g, " ").trim();
  return (text || "No se envió").slice(0, 180);
}

export function createSendLimiter() {
  const recent = new Map<string, number[]>();
  const tails = new Map<string, Promise<unknown>>();
  return {
    run<T>(
      accountId: string,
      job: () => Promise<T>,
      pace: { perMinute: number; now: () => number; sleep: (ms: number) => Promise<void> },
    ): Promise<T> {
      const previous = tails.get(accountId) ?? Promise.resolve();
      const next = previous.then(async () => {
        const now = pace.now();
        const decision = sendPace(recent.get(accountId) ?? [], now, pace.perMinute);
        if (decision.waitMs > 0) await pace.sleep(decision.waitMs);
        const at = pace.now();
        recent.set(accountId, [...decision.recent, at].filter((stamp) => at - stamp < 60_000));
        return job();
      });
      tails.set(accountId, next.then(() => undefined, () => undefined));
      return next;
    },
  };
}

function normalizeToken(value: string): string {
  return value.trim().replace(/^@+/, "").toLowerCase();
}

function normalizeBody(value: string): string {
  return value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
}
