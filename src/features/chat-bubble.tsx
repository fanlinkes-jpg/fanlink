import { useState } from "react";
import { ChevronLeft, ChevronRight, Film, Languages, Lock } from "lucide-react";
import { authorLabel, paymentLabel } from "@/lib/composer-tools";

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
  const slide = media[index] ?? null;
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
              <span className="grid h-full place-items-center text-[10px] text-[#6d7585]">Sin datos</span>
              {media.length > 1 ? (
                <>
                  <button type="button" aria-label="Anterior" className="absolute left-1 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full bg-black/45 text-white" onClick={() => setIndex((current) => (current - 1 + media.length) % media.length)}><ChevronLeft className="h-4 w-4" /></button>
                  <button type="button" aria-label="Siguiente" className="absolute right-1 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full bg-black/45 text-white" onClick={() => setIndex((current) => (current + 1) % media.length)}><ChevronRight className="h-4 w-4" /></button>
                </>
              ) : null}
              {slide.kind === "video" || slide.kind === "audio" ? <Film className="absolute right-2 top-2 h-4 w-4 text-white" aria-label="Vídeo" /> : null}
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
