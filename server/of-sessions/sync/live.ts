/**
 * El navegador se entera de un mensaje ya guardado como mucho en este plazo.
 * La API firmada deja el hilo abierto en la base en cada ciclo de 2 s
 * (`OPEN_CYCLE_MS`). Bajar de 2 s es acortar este intervalo, no la pantalla.
 */
export const LIVE_PUSH_MS = 2_000;

let openInboxes = 0;

export type InboxWatch = { creatorId: string; threadKey: string | null };

const threadWatches = new Map<string, InboxWatch>();

export function noteThreadWatch(creatorId: string | null, threadKey: string | null): () => void {
  const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  if (creatorId) threadWatches.set(id, { creatorId, threadKey });
  return () => {
    threadWatches.delete(id);
  };
}

export function activeThreadWatches(): InboxWatch[] {
  return [...threadWatches.values()];
}

export function noteInboxOpen(): () => void {
  openInboxes += 1;
  return () => {
    openInboxes = Math.max(0, openInboxes - 1);
  };
}

export function inboxIsOpen(): boolean {
  return openInboxes > 0;
}

/** La bandeja abierta no acorta el barrido. El tiempo real lo cubre la pestaña que escucha. */
export function chatIntervalMinutes(storedMin: number, _inboxOpen = false): number {
  return storedMin;
}

export function liveCursorChanged(previous: string | null, next: string | null): boolean {
  return next != null && next !== previous;
}
