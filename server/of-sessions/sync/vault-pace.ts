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
const folderTails = new Map<string, Promise<unknown>>();
const readMarks = new Map<string, "ok" | "fallo" | "parcial">();

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

/** Una lectura de esa carpeta a la vez. La siguiente espera; no lanza otro GET en paralelo. */
export function withFolderRead<T>(creatorId: string, listId: string, run: () => Promise<T>): Promise<T> {
  if (!listId || listId === "all") return run();
  const key = `${creatorId}\n${listId}`;
  const prev = folderTails.get(key) ?? Promise.resolve();
  const next = prev.then(run, run);
  folderTails.set(key, next.then(() => undefined, () => undefined));
  return next;
}

export function pauseVaultRate(accountId: string, retryAfterMs: number, now: number): number {
  const wait = Math.min(Math.max(0, retryAfterMs), VAULT_RATE_CAP_MS);
  pauseAccountFor(accountId, "429", wait, now);
  return wait;
}

export function clearVaultPace(): void {
  listDownUntil.clear();
  folderTails.clear();
  readMarks.clear();
}
