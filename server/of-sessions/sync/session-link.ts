import type { AccountPatch, ConnectionStatus, IdentityState, SessionStatus } from "../types.ts";

/** Texto visible. No es un 0 ni una cifra vacía. */
export const SESSION_EXPIRED_LABEL = "Sesión caducada, reconecta";

export type SignedReadAccount = {
  sessionRejected: boolean;
  connection: ConnectionStatus;
  identityState: IdentityState;
  status: SessionStatus;
  identityHandle: string | null;
  identityReason: string | null;
};

/**
 * La lista, las notificaciones y los fans en línea no piden estas cuentas.
 * `sessionRejected` solo lo quita un login que termina bien.
 */
export function signedReadsBlocked(account: {
  sessionRejected?: boolean;
  connection?: string | null;
}): boolean {
  return account.sessionRejected === true || account.connection === "login_required";
}

/** Conexión aceptada. Una cuenta rechazada no entra aquí. */
export function showsConnected(account: {
  connection: string;
  sessionRejected: boolean;
  status: string;
}): boolean {
  return account.connection === "live" && account.sessionRejected === false && account.status === "active";
}

/**
 * Cifra de la pantalla. Una cuenta bloqueada no enseña 0 ni un hueco:
 * enseña el aviso de reconectar.
 */
export function accountFigure(
  account: { sessionRejected?: boolean; connection?: string | null },
  count: number | null,
): string | number | null {
  if (signedReadsBlocked(account)) return SESSION_EXPIRED_LABEL;
  return count;
}

/** Aviso por cuenta bloqueada. Las que sí leen no desaparecen. */
export function accountSessionNotices(
  accounts: ReadonlyArray<{ creatorId: string | null; sessionRejected?: boolean; connection?: string | null }>,
  creatorIds: readonly string[],
): string[] {
  return accounts.flatMap((account) => {
    if (!account.creatorId || !creatorIds.includes(account.creatorId) || !signedReadsBlocked(account)) return [];
    return [`${account.creatorId}: ${SESSION_EXPIRED_LABEL}`];
  });
}

/** Todas las cuentas del alcance están bloqueadas. La vista no suma un 0. */
export function everyAccountBlocked(
  accounts: ReadonlyArray<{ creatorId: string; sessionRejected?: boolean; connection?: string | null }>,
  creatorIds: readonly string[],
): boolean {
  const known = accounts.filter((account) => creatorIds.includes(account.creatorId));
  return known.length > 0 && known.every((account) => signedReadsBlocked(account));
}

/**
 * Ids que pueden pasar a conectadas porque ya hubo una lista guardada bien
 * y no están rechazadas. No incluye `sessionRejected`: esa no vuelve sola.
 */
export function derivedConnectedIds(
  accounts: ReadonlyArray<SignedReadAccount & { id: string; creatorId: string | null }>,
  okCreatorIds: ReadonlySet<string>,
): string[] {
  return accounts.flatMap((account) => {
    if (!account.creatorId || !okCreatorIds.has(account.creatorId)) return [];
    return deriveConnectedFromLastRead(account, true) ? [account.id] : [];
  });
}

/**
 * La última lista guardada fue correcta y la cuenta no está rechazada.
 * Sirve para una conexión que se quedó en `login_required` después de un 200.
 */
export function deriveConnectedFromLastRead(account: SignedReadAccount, lastReadOk: boolean): AccountPatch | null {
  if (!lastReadOk || account.sessionRejected || account.connection !== "login_required") return null;
  return applySignedRead(account, 200);
}

/**
 * Efecto de una lectura firmada sobre `accounts.json`.
 * Un 200 deja la cuenta conectada y no borra `sessionRejected`.
 * Un 401 lo marca si aún no lo estaba. Si ya lo estaba, no reescribe.
 */
export function applySignedRead(
  account: SignedReadAccount,
  httpStatus: number,
  options?: { loginAlreadyOpen?: boolean; reason?: string | null },
): AccountPatch | null {
  if (httpStatus === 401) {
    if (account.sessionRejected) return null;
    const loginAlreadyOpen = options?.loginAlreadyOpen === true;
    const reason = redactReason(options?.reason) ?? "OnlyFans ha rechazado la sesión (401). Pulsa Reconectar.";
    return {
      status: loginAlreadyOpen ? "pending_login" : "expired",
      connection: "login_required",
      sessionRejected: true,
      loginInProgress: loginAlreadyOpen,
      lastError: reason,
      identityState: account.identityState === "mismatch" ? "mismatch" : "unavailable",
      identityReason: account.identityState === "mismatch" ? account.identityReason : reason,
    };
  }
  if (httpStatus !== 200 || account.sessionRejected) return null;
  const identityState = identityAfterOk(account);
  return {
    status: "active",
    connection: "live",
    identityState,
    identityReason: identityState === "unavailable" ? null : account.identityState === "mismatch" ? account.identityReason : null,
    lastError: null,
  };
}

function identityAfterOk(account: SignedReadAccount): IdentityState {
  if (account.identityState === "mismatch") return "mismatch";
  if (account.identityState === "verified") return "verified";
  if (account.identityHandle && account.identityHandle.trim()) return "verified";
  return "unavailable";
}

function redactReason(value: string | null | undefined): string | null {
  if (!value) return null;
  const text = value.replace(/cookie|set-cookie|authorization|sess=/gi, "[omitido]").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, 180) : null;
}
