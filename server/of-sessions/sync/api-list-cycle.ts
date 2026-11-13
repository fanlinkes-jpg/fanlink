/**
 * Un paso de la lista firmada. Cada cuenta se lee sola: un 401 o una
 * sesión que no está en disco no cancela a las demás.
 */
export type ApiListAccount = {
  id: string;
  creatorId: string | null;
  status: "active" | "expired" | "pending_login";
  identityState: string;
};

export type ApiListRead = {
  threadCount: number;
  messageCount: number;
  reason: string | null;
  sessionRejected: boolean;
  signatureRejected: boolean;
  retryAfterMs: number;
};

export type ApiListStep = {
  save: boolean;
  backoff: boolean;
  line: string;
};

export function shouldReadApiList(account: ApiListAccount, paused: boolean): boolean {
  if (!account.creatorId || account.identityState === "mismatch" || account.status !== "active") return false;
  return !paused;
}

export function apiListStep(account: ApiListAccount, read: ApiListRead): ApiListStep {
  const who = account.creatorId ?? account.id;
  if (read.signatureRejected) {
    return { save: false, backoff: true, line: `[fanlink:chat] api lista cuenta=${who}: OnlyFans rechazó la firma` };
  }
  if (read.sessionRejected) {
    return {
      save: false,
      backoff: false,
      line: `[fanlink:chat] api lista cuenta=${who}: ${read.reason ?? "sesión rechazada"}`,
    };
  }
  if (read.retryAfterMs > 0) {
    return { save: false, backoff: true, line: `[fanlink:chat] api lista cuenta=${who}: 429` };
  }
  if (read.threadCount === 0 && read.messageCount === 0) {
    return {
      save: false,
      backoff: false,
      line: `[fanlink:chat] api lista cuenta=${who}: ${read.reason ?? "sin hilos"}`,
    };
  }
  return {
    save: true,
    backoff: false,
    line: `[fanlink:chat] api lista creator=${who} hilos=${read.threadCount} mensajes=${read.messageCount}`,
  };
}

/** Recorre las cuentas en orden. Un fallo no corta el resto. */
export function runApiListCycle(
  accounts: readonly ApiListAccount[],
  readOf: (account: ApiListAccount) => ApiListRead,
  paused: (accountId: string) => boolean,
): { saved: string[]; lines: string[]; backoff: string[]; read: string[] } {
  const saved: string[] = [];
  const lines: string[] = [];
  const backoff: string[] = [];
  const read: string[] = [];
  for (const account of accounts) {
    if (!shouldReadApiList(account, paused(account.id))) continue;
    read.push(account.creatorId ?? account.id);
    const step = apiListStep(account, readOf(account));
    lines.push(step.line);
    if (step.save && account.creatorId) saved.push(account.creatorId);
    if (step.backoff) backoff.push(account.id);
  }
  return { saved, lines, backoff, read };
}
