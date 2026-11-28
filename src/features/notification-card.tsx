import { initialOf } from "@/lib/initial";
import { AtSign, Bell, DollarSign, Heart, Megaphone, MessageCircle, MessageSquare, ShoppingBag, Tag, ThumbsUp } from "lucide-react";
import { SfwMedia } from "@/components/sfw-media";
import type { NotificationListItem } from "@/lib/of-notifications";
import { isRecentFan, messageLinkSpans, notificationActionText, notificationOpensChat, notificationStamp, renewStatusLabel, spanishNotificationText, tabOf, type NotificationTab } from "@/lib/notifications";

export function NotificationFanCard({
  item,
  handle,
  avatarUrl,
  renew,
  reply = null,
  onChat,
  onMark,
  onMessage,
  onSeen,
}: {
  item: NotificationListItem;
  handle: string | null;
  avatarUrl: string | null;
  lists?: string[] | null;
  renew: boolean | null;
  reply?: string | null;
  onChat?: () => void;
  onMark?: () => void;
  onMessage?: () => void;
  /** Se llama al pulsar la tarjeta: abrirla es verla. */
  onSeen?: () => void;
}) {
  const name = item.fanName?.trim() || null;
  const user = handle?.replace(/^@/, "").trim() || null;
  const text = spanishNotificationText(item.body);
  const stamp = notificationStamp(item.occurredAt);
  const recent = isRecentFan(item.fanSeenAt, Date.now());
  const renewText = renewStatusLabel(renew);
  const canChat = Boolean(onChat) && Boolean(item.fanKey || item.threadKey) && notificationOpensChat(item.kind);
  const action = notificationActionText(item.kind);
  const amount = item.amountCents != null ? item.labels.amount : null;
  const postText = item.postText?.trim() || null;
  const unread = !item.seen;
  const initial = initialOf(name ?? user);
  const TypeIcon = typeIcon(tabOf(item.kind));
  return (
    <article className="flex gap-3 py-3 text-sm" data-kind={item.kind} data-unread={unread ? "true" : "false"} onClick={onSeen}>
      <span className="relative h-10 w-10 shrink-0">
        {avatarUrl ? (
          <SfwMedia><img src={avatarUrl} alt="" className="h-10 w-10 rounded-full object-cover" /></SfwMedia>
        ) : (
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#eef1f4] text-xs font-semibold text-[#3c4456]">{initial}</span>
        )}
        <span className="absolute -right-1 -bottom-1 grid h-4 w-4 place-items-center rounded-full bg-white text-[#1f9d55] ring-1 ring-[#e6e8ee]">
          <TypeIcon className="h-2.5 w-2.5" />
        </span>
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="min-w-0 text-[#1c2333]">
            {unread ? <span aria-label="Sin leer" className="mr-1.5 inline-block h-2 w-2 rounded-full bg-[#1f9d55] align-middle" /> : null}
            {name ? <span className="font-semibold">{name}</span> : null}
            {user ? <span className="text-[#6d7585]">{name ? " " : ""}@{user}</span> : null}
          </p>
          {canChat ? (
            <button type="button" aria-label="Abrir chat" className="shrink-0 rounded-full border border-[#e6e8ee] p-1.5 text-[#3c4456]" onClick={(event) => { event.stopPropagation(); onChat?.(); }}>
              <MessageCircle className="h-4 w-4" />
            </button>
          ) : null}
        </div>
        {renewText || recent ? (
          <p className="mt-1 flex flex-wrap gap-1 text-[11px]">
            {renewText ? <span className="rounded bg-[#f2f3f5] px-1.5 py-0.5 text-[#3c4456]">{renewText}</span> : null}
            {recent ? <span className="rounded bg-[#e7f8ef] px-1.5 py-0.5 text-[#1a7f45]">Reciente (últimas 24 h)</span> : null}
          </p>
        ) : null}
        <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
          <span className="rounded bg-[#eef1f4] px-1.5 py-0.5 font-medium text-[#3c4456]">{item.labels.title}</span>
          {amount ? <span className="rounded bg-[#e7f8ef] px-1.5 py-0.5 font-semibold text-[#1a7f45]">{amount}</span> : null}
        </p>
        {text ? <p className="mt-1 whitespace-pre-wrap break-words text-[#1c2333]">{messageParts(text, item.messageRef ?? null, onMessage)}</p> : action ? <p className="mt-1 text-[#1c2333]">{action}</p> : null}
        {postText || item.postLink ? (
          <div className="mt-1.5 rounded-lg border border-[#e6e8ee] bg-[#f8f9fb] px-2.5 py-1.5 text-xs text-[#3c4456]">
            <p className="text-[10px] font-medium uppercase tracking-wide text-[#8b909a]">{item.kind === "tag" ? "Mensaje o medio" : "Publicación"}</p>
            {postText ? <p className="whitespace-pre-wrap break-words">{postText}</p> : null}
            {item.postLink ? <a href={item.postLink} target="_blank" rel="noreferrer" className="text-[#2456c7] underline" onClick={(event) => event.stopPropagation()}>Ver en OnlyFans</a> : null}
          </div>
        ) : null}
        {stamp ? <p className="mt-1 text-xs text-[#8b909a]">{stamp}</p> : null}
        {reply ? <p className="mt-1 text-xs text-[#1f9d55]">{reply}</p> : null}
        {onMark ? (
          <button type="button" className="mt-1 text-xs text-[#6d7585] underline" onClick={(event) => { event.stopPropagation(); onMark?.(); }}>Marcar leída</button>
        ) : null}
      </div>
    </article>
  );
}

function messageParts(text: string, messageRef: string | null, onMessage?: () => void) {
  return messageLinkSpans(text, onMessage ? messageRef : null).map((part, index) => (
    part.link
      ? <button key={index} type="button" className="text-[#2456c7] underline" onClick={(event) => { event.stopPropagation(); onMessage?.(); }}>{part.text}</button>
      : <span key={index}>{part.text}</span>
  ));
}

function typeIcon(tab: NotificationTab) {
  switch (tab) {
    case "all":
      return Bell;
    case "subscriptions":
      return Heart;
    case "purchases":
      return ShoppingBag;
    case "tips":
      return DollarSign;
    case "tags":
      return Tag;
    case "comments":
      return MessageSquare;
    case "mentions":
      return AtSign;
    case "likes":
      return ThumbsUp;
    case "promotions":
      return Megaphone;
    case "onlyfans":
      return Bell;
    default: {
      const exhaustive: never = tab;
      return exhaustive;
    }
  }
}
