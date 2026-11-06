import type { ChatMedia } from "./chats.ts";
import { linkExpired } from "./media-stream.ts";

export type PlayDecision = { play: true; url: string; hls: boolean } | { play: false; notice: string };

/** Desbloqueado o propio se reproduce. El resto avisa, sin inventar un archivo. */
export function mediaPlay(media: ChatMedia, fromFan: boolean, now = Date.now()): PlayDecision {
  const priced = (media.priceCents ?? 0) > 0;
  const unpaid = media.locked === true || (media.paid === false && priced);
  if (unpaid && (fromFan || media.locked === true)) return { play: false, notice: blockedNotice(media.kind) };
  if (!media.full || linkExpired(media.full, now)) return { play: false, notice: "Enlace caducado, recarga el chat" };
  const hls = /\.m3u8(\?|$)/i.test(media.full);
  return { play: true, url: media.full, hls };
}

function blockedNotice(kind: ChatMedia["kind"]): string {
  if (kind === "audio") return "Audio bloqueado";
  if (kind === "foto") return "Foto bloqueada";
  return "Vídeo bloqueado";
}
