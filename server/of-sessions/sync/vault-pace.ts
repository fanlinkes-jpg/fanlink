import { pauseAccountFor } from "./backoff.ts";

/** Cuánto se recuerda que lists/{id}/media falla con 5xx en esa cuenta. */
export const LIST_MEDIA_DOWN_MS = 10 * 60 * 1000;
/** Tope de una pausa por 429. No deja la cuenta parada para siempre. */
export const VAULT_RATE_CAP_MS = 2 * 60 * 1000;
/** Hueco entre carpetas del recorrido de fondo. */
export const VAULT_FOLDER_GAP_MS = 2_500;

/** Entre dos páginas de bóveda: 3 s más un jitter de hasta 1,5 s. */
export function vaultPageWaitMs(unit: number): number {
  const span = Number.isFinite(unit) ? Math.min(1, Math.max(0, unit)) : 0;
  return 3_000 + Math.floor(span * 1_500);
}

let tailTicket = 0;
let tailCreatorId = "";
let tailActive = false;

/** La cola de fondo de otra creadora se cancela. Solo sigue una. */
export function beginVaultTail(creatorId: string): number {
  tailCreatorId = creatorId;
  tailActive = true;
  tailTicket += 1;
  return tailTicket;
}

export function vaultTailLive(ticket: number): boolean {
  return ticket === tailTicket;
}

export function vaultTailBusy(creatorId: string): boolean {
  return tailActive && tailCreatorId === creatorId;
}

export function finishVaultTail(ticket: number): void {
  if (ticket === tailTicket) tailActive = false;
}
/** Carpetas por tanda. El resto sigue después del hueco, no las 92 seguidas. */
export const VAULT_FOLDER_BATCH = 6;
/** Veces que una carpeta puede seguir cortada antes de pasar al final de la vuelta. */
export const VAULT_FOLDER_CUT_PASSES = 2;

const listDownUntil = new Map<string, number>();
const folderFlights = new Map<string, Promise<unknown>>();
const readMarks = new Map<string, "ok" | "fallo" | "parcial">();
type FolderCursor = {
  id: string;
  /** null: la carpeta ya se leyó y la siguiente vuelta empieza en la de después. Un número: hay que retomarla en ese offset. */
  resumeOffset: number | null;
  listKey: string;
  cuts: number;
};

const folderCursor = new Map<string, FolderCursor>();

export function noteListMediaDown(accountKey: string, now: number): void {
  listDownUntil.set(accountKey, now + LIST_MEDIA_DOWN_MS);
}

export function listMediaDown(accountKey: string, now: number): boolean {
  const until = listDownUntil.get(accountKey);
  if (until == null || until <= now) {
    listDownUntil.delete(accountKey);
    return false;
  }
  return true;
}

export function recordFolderRead(creatorId: string, listId: string, state: "ok" | "fallo" | "parcial"): void {
  readMarks.set(`${creatorId}\n${listId}`, state);
}

export function folderReadMark(creatorId: string, listId: string): "ok" | "fallo" | "parcial" | null {
  return readMarks.get(`${creatorId}\n${listId}`) ?? null;
}

/** La apertura manual reutiliza la lectura que ya va, no espera a que termine para empezar otra. */
export function shareFolderRead<T>(creatorId: string, listId: string, run: () => Promise<T>): Promise<T> {
  if (!listId || listId === "all") return run();
  const key = `${creatorId}\n${listId}`;
  const pending = folderFlights.get(key);
  if (pending) return pending as Promise<T>;
  const next = run().finally(() => {
    if (folderFlights.get(key) === next) folderFlights.delete(key);
  });
  folderFlights.set(key, next);
  return next;
}

export function folderCursorState(creatorId: string): FolderCursor | null {
  const saved = folderCursor.get(creatorId);
  return saved ? { ...saved } : null;
}

export function forgetFolderCursor(creatorId: string): void {
  folderCursor.delete(creatorId);
}

/** La carpeta se leyó entera. La vuelta siguiente sigue por la de después. */
export function rememberFolderCursor(creatorId: string, listId: string, listKey: string): void {
  folderCursor.set(creatorId, { id: listId, resumeOffset: null, listKey, cuts: 0 });
}

/** Un 429 dejó la carpeta a medias. La vuelta siguiente empieza aquí, en el mismo offset. */
export function rememberFolderCut(creatorId: string, listId: string, offset: number, listKey: string | null): void {
  const prev = folderCursor.get(creatorId);
  const cuts = prev?.id === listId ? prev.cuts + 1 : 1;
  folderCursor.set(creatorId, {
    id: listId,
    resumeOffset: offset,
    listKey: listKey ?? prev?.listKey ?? "",
    cuts,
  });
}

export function pauseVaultRate(accountId: string, retryAfterMs: number, now: number): number {
  const wait = Math.min(Math.max(0, retryAfterMs), VAULT_RATE_CAP_MS);
  pauseAccountFor(accountId, "429", wait, now);
  return wait;
}

export function clearVaultPace(): void {
  listDownUntil.clear();
  folderFlights.clear();
  readMarks.clear();
  folderCursor.clear();
  tailTicket += 1;
  tailActive = false;
  tailCreatorId = "";
}
