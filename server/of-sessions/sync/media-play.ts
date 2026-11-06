import type { ChatMedia } from "./chats.ts";
import { linkExpired } from "./media-stream.ts";

export type PlayDecision = { play: true; url: string; hls: boolean } | { play: false; notice: string };

/** Lo propio se reproduce si hay URL. Lo del fan sigue canView / el candado. */
export function mediaPlay(media: ChatMedia, fromFan: boolean, now = Date.now()): PlayDecision {
  if (!fromFan) {
    if (!media.full || linkExpired(media.full, now)) return { play: false, notice: "Enlace caducado, recarga el chat" };
    const hls = /\.m3u8(\?|$)/i.test(media.full);
    return { play: true, url: media.full, hls };
  }
  const priced = (media.priceCents ?? 0) > 0;
  const blocked = media.locked === true || (media.locked == null && media.paid === false && priced);
  if (blocked) return { play: false, notice: blockedNotice(media.kind) };
  if (!media.full || linkExpired(media.full, now)) return { play: false, notice: "Enlace caducado, recarga el chat" };
  const hls = /\.m3u8(\?|$)/i.test(media.full);
  return { play: true, url: media.full, hls };
}

function blockedNotice(kind: ChatMedia["kind"]): string {
  if (kind === "audio") return "Audio bloqueado";
  if (kind === "foto") return "Foto bloqueada";
  return "Vídeo bloqueado";
}
