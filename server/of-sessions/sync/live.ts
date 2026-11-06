/** El navegador se entera de un mensaje ya guardado como mucho en este plazo. */
export const LIVE_PUSH_MS = 2_000;

/** Con la bandeja abierta, la siguiente lectura de chats puede salir a los 45 s. */
export const OPEN_INBOX_SYNC_MS = 45_000;

let openInboxes = 0;

export function noteInboxOpen(): () => void {
  openInboxes += 1;
  return () => {
    openInboxes = Math.max(0, openInboxes - 1);
  };
}

export function inboxIsOpen(): boolean {
  return openInboxes > 0;
}

export function chatIntervalMinutes(storedMin: number, inboxOpen: boolean): number {
  if (!inboxOpen) return storedMin;
  return Math.min(storedMin, OPEN_INBOX_SYNC_MS / 60_000);
}

export function liveCursorChanged(previous: string | null, next: string | null): boolean {
  return next != null && next !== previous;
}
