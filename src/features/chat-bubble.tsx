import { Lock, Play } from "lucide-react";
import { authorLabel, paymentLabel } from "@/lib/composer-tools";

export type BubbleMedia = {
  kind: "foto" | "video" | "audio" | null;
  seconds: number | null;
  preview: string | null;
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

export function ChatBubble({ message }: { message: BubbleMessage }) {
  const text = message.body.trim();
  return (
    <li className={message.fromFan ? "text-left" : "text-right"}>
      <div className={`inline-block max-w-[70%] rounded-2xl px-3 py-2 text-sm ${message.fromFan ? "bg-[#f4f6fb]" : "bg-[#e7f0ff]"}`}>
        {message.eventKind === "compra" ? <p className="text-xs font-medium text-[#137333]">{purchaseLine(message.eventCents)}</p> : null}
        {message.eventKind === "propina" ? <p className="text-xs font-medium text-[#8a5a12]">{tipLine(message.eventCents)}</p> : null}
        {message.replyBody ? <blockquote className="mb-1 border-l-2 border-[#c5cad6] pl-2 text-xs text-[#6d7585]">{message.replyBody}</blockquote> : null}
        {message.media && message.media.length > 0 ? (
          <div className="mb-1 flex flex-wrap gap-1">
            {message.media.map((item, index) => (
              <figure key={`${message.messageKey}-${index}`} className="relative h-24 w-24 overflow-hidden rounded-lg bg-[#e6e8ee]">
                {item.preview ? (
                  <img src={`/api/chat-media?creatorId=${encodeURIComponent(message.creatorId)}&messageKey=${encodeURIComponent(message.messageKey)}&index=${index}`} alt="" className="h-full w-full object-cover" />
                ) : (
                  <span className="grid h-full place-items-center text-[10px] text-[#6d7585]">Sin datos</span>
                )}
                {item.kind === "video" || item.kind === "audio" ? <Play className="absolute bottom-1 left-1 h-4 w-4 text-white" aria-label="Reproducir" /> : null}
                {item.locked ? <Lock className="absolute right-1 top-1 h-4 w-4 text-white" aria-label="Bloqueado" /> : null}
                {paidLabel(item.priceCents, item.paid) ? (
                  <figcaption className={`absolute inset-x-0 bottom-0 px-1 text-[10px] font-semibold text-white ${item.paid ? "bg-[#137333]" : "bg-[#b42318]"}`}>
                    {paidLabel(item.priceCents, item.paid)}
                  </figcaption>
                ) : null}
              </figure>
            ))}
          </div>
        ) : null}
        {text && !message.eventKind ? <p>{text}</p> : null}
        {message.automatic ? <p className="text-[10px] uppercase tracking-wide text-[#6d7585]">Masivo</p> : null}
      </div>
      <p className="mt-1 text-[10px] text-[#6d7585]">
        {bubbleCaption(message)}
        {message.liked ? <span aria-label="Me gusta"> ♥</span> : null}
      </p>
    </li>
  );
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

function bubbleCaption(message: BubbleMessage): string {
  const time = message.sentAt.slice(0, 16).replace("T", " ");
  const seen = message.seen == null ? "" : message.seen ? " · ✓✓" : " · ✓";
  if (message.fromFan) return `${time}${seen}`;
  const pay = paymentLabel(message);
  const who = message.authorName ? authorLabel(message.authorName, false) : authorLabel(null, message.automatic);
  return `${time}${seen}${pay ? ` · ${pay}` : ""} · ${who}`;
}
