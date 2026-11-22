import { Bell, DollarSign, Heart, MessageCircle, ShoppingBag } from "lucide-react";
import type { NotificationListItem } from "@/lib/of-notifications";
import { inflowwTabOf, isRecentFan, notificationStamp, renewStatusLabel, spanishNotificationText } from "@/lib/notifications";

export function NotificationFanCard({
  item,
  handle,
  avatarUrl,
  renew,
  reply = null,
  onChat,
  onMark,
}: {
  item: NotificationListItem;
  handle: string | null;
  avatarUrl: string | null;
  lists?: string[] | null;
  renew: boolean | null;
  reply?: string | null;
  onChat?: () => void;
  onMark?: () => void;
}) {
  const name = item.fanName?.trim() || null;
  const user = handle?.replace(/^@/, "").trim() || null;
  const text = spanishNotificationText(item.body);
  const stamp = notificationStamp(item.occurredAt);
  const recent = isRecentFan(item.fanSeenAt, Date.now());
  const renewText = renewStatusLabel(renew);
  const canChat = Boolean(onChat) && Boolean(item.fanKey || item.threadKey);
  const initial = (name ?? user ?? "?").slice(0, 1).toUpperCase();
  const TypeIcon = typeIcon(inflowwTabOf(item.kind));
  return (
    <article className="flex gap-3 py-3 text-sm">
      <span className="relative h-10 w-10 shrink-0">
        {avatarUrl ? (
          <img src={avatarUrl} alt="" className="h-10 w-10 rounded-full object-cover" />
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
            {name ? <span className="font-semibold">{name}</span> : null}
            {user ? <span className="text-[#6d7585]">{name ? " " : ""}@{user}</span> : null}
          </p>
          {canChat ? (
            <button type="button" aria-label="Abrir chat" className="shrink-0 rounded-full border border-[#e6e8ee] p-1.5 text-[#3c4456]" onClick={onChat}>
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
        {text ? <p className="mt-1 text-[#1c2333]">{text}</p> : null}
        {stamp ? <p className="mt-1 text-xs text-[#8b909a]">{stamp}</p> : null}
        {reply ? <p className="mt-1 text-xs text-[#1f9d55]">{reply}</p> : null}
        {onMark ? (
          <button type="button" className="mt-1 text-xs text-[#6d7585] underline" onClick={onMark}>Marcar leída</button>
        ) : null}
      </div>
    </article>
  );
}

function typeIcon(tab: "subscriptions" | "tips" | "purchases" | "onlyfans") {
  switch (tab) {
    case "subscriptions":
      return Heart;
    case "tips":
      return DollarSign;
    case "purchases":
      return ShoppingBag;
    case "onlyfans":
      return Bell;
    default: {
      const exhaustive: never = tab;
      return exhaustive;
    }
  }
}
