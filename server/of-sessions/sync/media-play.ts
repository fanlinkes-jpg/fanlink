import type { ChatMedia } from "./chats.ts";
import { linkExpired } from "./media-stream.ts";

export type PlayDecision = { play: true; url: string; hls: boolean } | { play: false; notice: string };

/** Lo del fan está bloqueado si canView lo cerró, o si hay precio y no consta pagado. */
export function fanMediaBlocked(media: ChatMedia): boolean {
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

/** Lo propio se reproduce si hay URL. Lo del fan sigue canView / el candado. */
export function mediaPlay(media: ChatMedia, fromFan: boolean, now = Date.now()): PlayDecision {
  if (!fromFan) {
    if (!media.full || linkExpired(media.full, now)) return { play: false, notice: "Enlace caducado, recarga el chat" };
    return { play: true, url: media.full, hls: /\.m3u8(\?|$)/i.test(media.full) };
  }
  if (fanMediaBlocked(media)) return { play: false, notice: blockedNotice(media.kind) };
  if (!media.full || linkExpired(media.full, now)) return { play: false, notice: "Enlace caducado, recarga el chat" };
  return { play: true, url: media.full, hls: /\.m3u8(\?|$)/i.test(media.full) };
}

function blockedNotice(kind: ChatMedia["kind"]): string {
  if (kind === "audio") return "Audio bloqueado";
  if (kind === "foto") return "Foto bloqueada";
  return "Vídeo bloqueado";
}
