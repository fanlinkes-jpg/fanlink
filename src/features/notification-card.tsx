import { MessageCircle } from "lucide-react";
import type { NotificationListItem } from "@/lib/of-notifications";
import { isRecentFan, notificationStamp, renewLabel, spanishNotificationText } from "@/lib/notifications";

export function NotificationFanCard({
  item,
  handle,
  avatarUrl,
  lists,
  renew,
  onChat,
  onMark,
}: {
  item: NotificationListItem;
  handle: string | null;
  avatarUrl: string | null;
  lists: string[] | null;
  renew: boolean | null;
  onChat?: () => void;
  onMark?: () => void;
}) {
  const name = item.fanName;
  const text = spanishNotificationText(item.body) ?? item.labels.body;
  const stamp = notificationStamp(item.occurredAt);
  const recent = isRecentFan(item.fanSeenAt, Date.now());
  const renewText = renewLabel(renew);
  const canChat = Boolean(onChat) && Boolean(item.fanKey || item.threadKey);
  const initial = (name ?? handle ?? item.labels.title).slice(0, 1).toUpperCase();
  return (
    <article className="flex gap-3 text-sm">
      {avatarUrl ? (
        <img src={avatarUrl} alt="" className="h-10 w-10 shrink-0 rounded-full object-cover" />
      ) : (
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#eef1f4] text-xs font-semibold text-[#3c4456]">{initial}</span>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="min-w-0 text-[#1c2333]">
            <span className="font-semibold">{name ?? handle ?? item.labels.title}</span>
            {name && handle ? <span className="text-[#6d7585]"> @{handle}</span> : null}
          </p>
          {canChat ? (
            <button type="button" aria-label="Abrir chat" className="shrink-0 rounded-full border border-[#e3e6eb] p-1.5 text-[#3c4456]" onClick={onChat}>
              <MessageCircle className="h-4 w-4" />
            </button>
          ) : null}
        </div>
        {lists && lists.length > 0 ? (
          <div className="mt-1 flex flex-wrap gap-1">
            {lists.map((list) => (
              <span key={list} className="rounded bg-[#f2f3f5] px-1.5 py-0.5 text-[11px] text-[#3c4456]">{list}</span>
            ))}
          </div>
        ) : null}
        {renewText || recent ? (
          <p className="mt-1 flex flex-wrap gap-1 text-[11px]">
            {renewText ? <span className="rounded bg-[#f2f3f5] px-1.5 py-0.5 text-[#3c4456]">{renewText}</span> : null}
            {recent ? <span className="rounded bg-[#e7f8ef] px-1.5 py-0.5 text-[#1a7f45]">Reciente (últimas 24 h)</span> : null}
          </p>
        ) : null}
        {text ? <p className="mt-1 text-[#1c2333]">{text}</p> : null}
        {item.kind === "comment" && item.postText ? <p className="mt-1 text-xs text-[#6d7585]">{item.postText}</p> : null}
        {item.kind === "comment" && item.postLink ? (
          <a href={item.postLink} className="mt-1 block truncate text-xs text-[#1890d4]" target="_blank" rel="noreferrer">{item.postLink}</a>
        ) : null}
        {item.labels.amount ? <p className="mt-1 tabular-nums text-[#1c2333]">{item.labels.amount}</p> : null}
        {stamp ? <p className="mt-1 text-xs text-[#8b909a]">{stamp}</p> : null}
        {onMark ? (
          <button type="button" className="mt-1 text-xs text-[#6d7585] underline" onClick={onMark}>Marcar leída</button>
        ) : null}
      </div>
    </article>
  );
}
