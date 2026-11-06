import type { ChatMedia } from "./chats.ts";

/** La misma regla que mediaPlay del hilo: el fan bloqueado no abre. Lo propio sí. */
function fanMediaBlocked(media: ChatMedia): boolean {
  const priced = (media.priceCents ?? 0) > 0;
  return media.locked === true || (media.locked == null && media.paid === false && priced);
}

/**
 * Lo que sale hacia el navegador.
 * El archivo completo de un medio bloqueado del fan se queda en el servidor.
 */
export function mediaForBrowser(media: ChatMedia[] | null | undefined, fromFan: boolean): ChatMedia[] | null {
  if (!media || media.length === 0) return null;
  if (!fromFan) return media.map((item) => ({ ...item }));
  return media.map((item) => (fanMediaBlocked(item) ? { ...item, full: null } : { ...item }));
}
