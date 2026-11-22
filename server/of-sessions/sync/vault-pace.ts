import { pauseAccountFor } from "./backoff.ts";

/** Cuánto se recuerda que lists/{id}/media falla con 5xx en esa cuenta. */
export const LIST_MEDIA_DOWN_MS = 10 * 60 * 1000;
/** Tope de una pausa por 429. No deja la cuenta parada para siempre. */
export const VAULT_RATE_CAP_MS = 2 * 60 * 1000;
/** Hueco entre carpetas del recorrido de fondo. */
export const VAULT_FOLDER_GAP_MS = 2_500;
/** Carpetas por tanda. El resto sigue después del hueco, no las 92 seguidas. */
export const VAULT_FOLDER_BATCH = 6;

const listDownUntil = new Map<string, number>();
const folderFlights = new Map<string, Promise<unknown>>();
const readMarks = new Map<string, "ok" | "fallo" | "parcial">();
const folderCursor = new Map<string, string>();

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

export function folderCursorOf(creatorId: string): string | null {
  return folderCursor.get(creatorId) ?? null;
}

export function rememberFolderCursor(creatorId: string, listId: string): void {
  folderCursor.set(creatorId, listId);
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
}
