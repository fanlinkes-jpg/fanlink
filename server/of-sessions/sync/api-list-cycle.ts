import { accountPause } from "./backoff.ts";
import type { CollectedChats } from "./collect-chats.ts";

/**
 * Un paso de la lista firmada. Cada cuenta se lee sola: un 401 o una
 * sesión que no está en disco no cancela a las demás.
 */
export type ApiListAccount = {
  id: string;
  creatorId: string | null;
  status: "active" | "expired" | "pending_login";
  identityState: string;
  /** False: no hay archivo de sesión. Undefined se trata como presente. */
  hasStorageState?: boolean;
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
  if (account.hasStorageState === false) return false;
  return !paused;
}

/** Aviso de una cuenta que no se lee. La segunda vez, null: no se repite cada ciclo. */
export function skipApiListNotice(account: ApiListAccount, seen: Set<string>): string | null {
  if (shouldReadApiList(account, false)) return null;
  if (seen.has(account.id)) return null;
  seen.add(account.id);
  const why = account.hasStorageState === false
    ? "sin sesión guardada"
    : account.identityState === "mismatch"
      ? "no coincide"
      : account.status;
  return `[fanlink:chat] api lista creator=${account.creatorId ?? "-"} account=${account.id}: se omite (${why})`;
}

function errorLine(account: ApiListAccount, detail: string): string {
  const text = detail.replace(/\s+creator=\S+\s+account=\S+/g, "").trim();
  return `[fanlink:chat] api lista creator=${account.creatorId ?? "-"} account=${account.id}: ${text}`;
}

export function apiListStep(account: ApiListAccount, read: ApiListRead): ApiListStep {
  const who = account.creatorId ?? account.id;
  if (read.signatureRejected) {
    return { save: false, backoff: true, line: errorLine(account, "OnlyFans rechazó la firma") };
  }
  if (read.sessionRejected) {
    return { save: false, backoff: false, line: errorLine(account, read.reason ?? "sesión rechazada") };
  }
  if (read.retryAfterMs > 0) {
    return { save: false, backoff: true, line: errorLine(account, "429") };
  }
  if (read.threadCount === 0 && read.messageCount === 0) {
    return { save: false, backoff: false, line: errorLine(account, read.reason ?? "sin hilos") };
  }
  return {
    save: true,
    backoff: false,
    line: `[fanlink:chat] api lista creator=${who} account=${account.id} hilos=${read.threadCount} mensajes=${read.messageCount}`,
  };
}

type PacedReader = {
  readPacedChats(accountId: string, part: "list" | "all", openThreadKeys?: string[]): Promise<CollectedChats>;
};

/**
 * Una pasada del bucle de fondo. La omisión se avisa una vez y se olvida
 * cuando la cuenta vuelve a poder leerse. No hay una lista de ausentes:
 * si `hasStorageState` pasa a true, el ciclo siguiente entra.
 */
export async function passApiListAccounts<T extends ApiListAccount>(
  sessions: PacedReader,
  accounts: readonly T[],
  noted: Set<string>,
  finish: (account: T, read: CollectedChats) => Promise<void>,
  log: (line: string) => void = (line) => console.info(line),
): Promise<void> {
  for (const account of accounts) {
    if (shouldReadApiList(account, false)) noted.delete(account.id);
    if (!shouldReadApiList(account, accountPause(account.id) != null)) {
      if (accountPause(account.id)) continue;
      const notice = skipApiListNotice(account, noted);
      if (notice) log(notice);
      continue;
    }
    try {
      const read = await sessions.readPacedChats(account.id, "list");
      if (read.reason?.includes("espera el ritmo")) continue;
      await finish(account, read);
    } catch (error) {
      const text = error instanceof Error ? error.message.slice(0, 120) : "error";
      log(`[fanlink:chat] api lista creator=${account.creatorId ?? "-"} account=${account.id}: ${text}`);
    }
  }
}
