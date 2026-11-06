import { useEffect, useRef, useState } from "react";
import Hls from "hls.js";
import { ChevronLeft, ChevronRight, Film, Languages, Lock, Play } from "lucide-react";
import { authorLabel, paymentLabel } from "@/lib/composer-tools";
import { nextMediaIndex } from "@/lib/media-carousel";
import { mediaPlay } from "../../server/of-sessions/sync/media-play.ts";

export type BubbleMedia = {
  kind: "foto" | "video" | "audio" | null;
  seconds: number | null;
  preview: string | null;
  full: string | null;
  locked: boolean | null;
  priceCents: number | null;
  paid: boolean | null;
  opened: boolean | null;
};

export type BubbleMessage = {
  creatorId: string;
  messageKey: string;
  fromFan: boolean;
  body: string;
  sentAt: string;
  priceCents: number | null;
  purchased: boolean | null;
  authorName: string | null;
  seen: boolean | null;
  automatic: boolean | null;
  media: BubbleMedia[] | null;
  liked: boolean | null;
  replyBody: string | null;
  eventKind: "compra" | "propina" | null;
  eventCents: number | null;
};

export function ChatBubble({ message, avatarUrl = null }: { message: BubbleMessage; avatarUrl?: string | null }) {
  const media = message.media ?? [];
  const [index, setIndex] = useState(0);
  const [open, setOpen] = useState(false);
  const slide = media[index] ?? null;
  const decision = slide ? mediaPlay({ ...slide, full: slide.full ?? null }, message.fromFan) : null;
  const text = message.body.trim();
  const initial = (message.fromFan ? "F" : message.authorName ?? "A").slice(0, 1).toLocaleUpperCase("es-ES");
  return (
    <li className={`flex items-end gap-2 ${message.fromFan ? "" : "justify-end"}`}>
      {message.fromFan ? <Avatar url={avatarUrl} initial={initial} /> : null}
      <div className={`max-w-[70%] ${message.fromFan ? "" : "text-right"}`}>
        <div className={`inline-block w-full rounded-2xl px-3 py-2 text-left text-sm ${message.fromFan ? "bg-[#f4f6fb]" : "bg-[#e7f0ff]"}`}>
          {message.eventKind === "compra" ? <p className="text-xs font-medium text-[#137333]">{purchaseLine(message.eventCents)}</p> : null}
          {message.eventKind === "propina" ? <p className="text-xs font-medium text-[#8a5a12]">{tipLine(message.eventCents)}</p> : null}
          {message.replyBody ? <blockquote className="mb-1 border-l-2 border-[#c5cad6] pl-2 text-xs text-[#6d7585]">{message.replyBody}</blockquote> : null}
          {slide ? (
            <figure className="relative mb-1 h-52 overflow-hidden rounded-lg bg-[#d7dbe3]">
              {slide.preview ? (
                <img src={`/api/chat-media?creatorId=${encodeURIComponent(message.creatorId)}&threadKey=${encodeURIComponent(message.threadKey ?? "")}&messageKey=${encodeURIComponent(message.messageKey)}&index=${index}`} alt="" className={`h-full w-full object-cover ${decision && !decision.play ? "scale-110 blur-md" : ""}`} />
              ) : (
                <span className="grid h-full place-items-center text-[10px] text-[#6d7585]">Sin datos</span>
              )}
              {media.length > 1 ? (
                <>
                  <button type="button" aria-label="Anterior" className="absolute left-1 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full bg-black/45 text-white" onClick={() => setIndex((current) => nextMediaIndex(current, media.length, -1))}><ChevronLeft className="h-4 w-4" /></button>
                  <button type="button" aria-label="Siguiente" className="absolute right-1 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full bg-black/45 text-white" onClick={() => setIndex((current) => nextMediaIndex(current, media.length, 1))}><ChevronRight className="h-4 w-4" /></button>
                </>
              ) : null}
              {slide.kind === "video" || slide.kind === "audio" ? <Film className="absolute right-2 top-2 h-4 w-4 text-white" aria-label="Vídeo" /> : null}
              {decision?.play ? (
                <button
                  type="button"
                  aria-label={slide.kind === "foto" ? "Ver foto" : "Reproducir"}
                  className="absolute inset-y-0 left-10 right-10 grid place-items-center"
                  onClick={() => setOpen(true)}
                >
                  {slide.kind === "video" || slide.kind === "audio" ? <Play className="h-8 w-8 text-white" /> : null}
                </button>
              ) : null}
              {slide.locked ? <Lock className="absolute left-2 top-2 h-4 w-4 text-white" aria-label="Bloqueado" /> : null}
              <span className="absolute bottom-1 left-1/2 -translate-x-1/2 rounded bg-black/55 px-1.5 text-[10px] text-white">{index + 1}/{media.length}</span>
              {paidLabel(slide.priceCents, slide.paid) ? (
                <figcaption className={`absolute inset-x-0 bottom-6 px-1 text-[10px] font-semibold text-white ${slide.paid ? "bg-[#137333]" : "bg-[#b42318]"}`}>
                  {paidLabel(slide.priceCents, slide.paid)}
                </figcaption>
              ) : null}
            </figure>
          ) : null}
          {text && !message.eventKind ? <p>{text}</p> : null}
        </div>
        {open && slide && decision ? (
          <MediaViewer
            kind={slide.kind}
            hls={decision.play ? decision.hls : false}
            src={decision.play ? mediaSrc(message, index, "full") : null}
            notice={decision.play ? null : decision.notice}
            onClose={() => setOpen(false)}
          />
        ) : null}
        <p className="mt-1 flex items-center gap-1 text-[10px] text-[#6d7585]">
          <button type="button" aria-label="Traducir" title="Sin datos" className="text-[#6d7585]"><Languages className="h-3.5 w-3.5" /></button>
          <span>{clockLabel(message.sentAt)}</span>
          {message.automatic ? <span>Automated Message</span> : null}
          {message.seen == null ? null : <span>{message.seen ? "✓✓" : "✓"}</span>}
          {message.liked ? <span aria-label="Me gusta">♥</span> : null}
          <span>{whoLabel(message)}</span>
          {paymentLabel(message) ? <span>{paymentLabel(message)}</span> : null}
        </p>
      </div>
      {message.fromFan ? null : <Avatar url={avatarUrl} initial={initial} />}
    </li>
  );
}

function mediaSrc(message: BubbleMessage, index: number, variant: "full"): string {
  return `/api/chat-media?creatorId=${encodeURIComponent(message.creatorId)}&threadKey=${encodeURIComponent(message.threadKey ?? "")}&messageKey=${encodeURIComponent(message.messageKey)}&index=${index}&variant=${variant}`;
}

function MediaViewer({ kind, hls, src, notice, onClose }: { kind: BubbleMedia["kind"]; hls: boolean; src: string | null; notice: string | null; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = videoRef.current;
    if (!hls || !src || !video) return;
    if (!Hls.isSupported()) {
      video.src = src;
      return;
    }
    const player = new Hls({ autoStartLoad: true });
    player.loadSource(src);
    player.attachMedia(video);
    return () => player.destroy();
  }, [hls, src]);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-4" role="dialog" aria-label="Reproducir">
      <button type="button" className="absolute right-4 top-4 rounded bg-white/90 px-3 py-1 text-sm" onClick={onClose}>Cerrar</button>
      {notice || !src ? <p className="text-sm font-medium text-white">{notice ?? "Enlace caducado, recarga el chat"}</p> : null}
      {!notice && src && kind === "audio" ? <audio controls preload="none" src={src} className="w-full max-w-md" /> : null}
      {!notice && src && kind === "foto" ? <img src={src} alt="" className="max-h-[80vh] max-w-full object-contain" /> : null}
      {!notice && src && kind !== "audio" && kind !== "foto" ? <video ref={videoRef} controls preload="none" src={hls ? undefined : src} className="max-h-[80vh] max-w-full" /> : null}
    </div>
  );
}

function Avatar({ url, initial }: { url: string | null; initial: string }) {
  if (url) return <img src={url} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover" />;
  return <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#e6e8ee] text-[10px] font-semibold text-[#1c2333]">{initial}</span>;
}

function paidLabel(cents: number | null, paid: boolean | null): string | null {
  if (cents == null || cents <= 0 || paid == null) return null;
  if (paid) return `$${(cents / 100).toFixed(2)} paid`;
  return "not paid";
}

function purchaseLine(cents: number | null): string {
  if (cents == null) return "Purchased — has purchased your message";
  return `Purchased — has purchased your message for $${(cents / 100).toFixed(2)}`;
}

function tipLine(cents: number | null): string {
  if (cents == null) return "Tip";
  return `Tip — $${(cents / 100).toFixed(2)}`;
}

function clockLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso.slice(11, 16);
  return date.toLocaleTimeString("es-ES", { hour: "numeric", minute: "2-digit" });
}

function whoLabel(message: BubbleMessage): string {
  if (message.fromFan) return "";
  return message.authorName ? authorLabel(message.authorName, false) : authorLabel(null, message.automatic);
}
