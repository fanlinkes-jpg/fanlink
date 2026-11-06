import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { Button, Field } from "@/components/ui";
import {
  filterNotifications,
  NOTIFICATION_TABS,
  TAB_LABEL,
  unreadCount,
  SIN_DATOS,
  type NotificationRecord,
  type NotificationTab,
} from "@/lib/notifications";
import { listCreatorNotifications, markCreatorNotificationsRead, type NotificationListItem } from "@/lib/of-notifications";

export type NotificationTarget = {
  creatorId: string;
  fanKey: string | null;
  threadKey: string | null;
};

/**
 * Campana de una creadora. El chat la monta en la cabecera de esa cuenta,
 * sin que esta rama edite la consola:
 *
 * <NotificationBell creatorId={id} onOpenThread={(target) => abrir el hilo} />
 *
 * El punto de montaje previsto es la barra de la creadora en
 * src/features/real-chats.tsx. Abrir el panel no sincroniza.
 */
export function NotificationBell({
  creatorId,
  onOpenThread,
}: {
  creatorId: string;
  onOpenThread?: (target: NotificationTarget) => void;
}) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationListItem[] | null>(null);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [role, setRole] = useState<"owner" | "member" | null>(null);

  useEffect(() => {
    let stop = false;
    async function pull() {
      try {
        const data = await listCreatorNotifications({ data: { creatorId } });
        if (stop) return;
        setItems(data.items);
        setSyncedAt(data.syncedAt);
        setNextCursor(data.nextCursor);
        setRole(data.role);
      } catch {
        if (!stop) setItems(null);
      }
    }
    void pull();
    const timer = setInterval(() => void pull(), 15_000);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, [creatorId]);

  async function loadMore() {
    if (!nextCursor) return;
    const data = await listCreatorNotifications({ data: { creatorId, cursor: nextCursor } });
    setItems((current) => [...(current ?? []), ...data.items]);
    setNextCursor(data.nextCursor);
  }

  const records = (items ?? []).map((item) => asRecord(creatorId, item));
  const unread = items == null ? null : unreadCount(records);

  return (
    <>
      <button
        type="button"
        aria-label={unread == null ? "Notificaciones, sin datos" : `Notificaciones, ${unread} sin leer`}
        onClick={() => setOpen(true)}
        className="relative grid h-8 w-8 place-items-center rounded-lg border border-line bg-surface text-fg"
      >
        <Bell className="h-4 w-4" />
        {unread != null && unread > 0 ? (
          <span className="absolute -top-1 -right-1 min-w-4 rounded-full bg-danger px-1 text-[10px] font-semibold text-white">{unread}</span>
        ) : null}
      </button>
      {open ? (
        <NotificationPanel
          creatorId={creatorId}
          role={role}
          items={items}
          syncedAt={syncedAt}
          onClose={() => setOpen(false)}
          onChanged={setItems}
          onOpenThread={onOpenThread}
          nextCursor={nextCursor}
          onMore={() => void loadMore()}
        />
      ) : null}
    </>
  );
}

function NotificationPanel({
  creatorId,
  role,
  items,
  syncedAt,
  onClose,
  onChanged,
  onOpenThread,
  nextCursor,
  onMore,
}: {
  creatorId: string;
  role: "owner" | "member" | null;
  items: NotificationListItem[] | null;
  syncedAt: string | null;
  onClose: () => void;
  onChanged: (items: NotificationListItem[]) => void;
  onOpenThread?: (target: NotificationTarget) => void;
  nextCursor: string | null;
  onMore: () => void;
}) {
  const [tab, setTab] = useState<NotificationTab>("all");
  const [text, setText] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const records = (items ?? []).map((item) => asRecord(creatorId, item));
  const filtered = filterNotifications(records, { tab, text, from, to });
  const shown = filtered.rows;
  const undated = filtered.undated;
  const shownUnread = [...shown, ...undated].filter((row) => !row.seenAt).map((row) => row.key);

  async function mark(keys: string[]) {
    if (keys.length === 0) return;
    await markCreatorNotificationsRead({ data: { creatorId, keys } });
    if (!items) return;
    const chosen = new Set(keys);
    onChanged(items.map((item) => (chosen.has(item.key) ? { ...item, seen: true } : item)));
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30">
      <button className="absolute inset-0" aria-label="Cerrar notificaciones" onClick={onClose} />
      <aside className="relative flex h-full w-full max-w-md flex-col bg-surface shadow-xl">
        <header className="flex items-center justify-between border-b border-line px-4 py-3">
          <div>
            <h2 className="font-display text-base font-semibold">Notificaciones</h2>
            <p className="text-xs text-muted">{role === "owner" ? "Dueña" : role === "member" ? "Chatter" : SIN_DATOS} · lo ya escuchado de esta cuenta</p>
          </div>
          <Button type="button" variant="ghost" onClick={onClose}>Cerrar</Button>
        </header>
        <div className="space-y-3 border-b border-line px-4 py-3">
          <div className="flex gap-1 overflow-auto">
            {NOTIFICATION_TABS.map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={`shrink-0 rounded-md px-2 py-1 text-xs ${tab === id ? "bg-primary text-primary-fg" : "bg-raised text-muted"}`}
              >
                {TAB_LABEL[id]}
              </button>
            ))}
          </div>
          <Field aria-label="Buscar notificaciones" value={text} placeholder="Buscar" onChange={(event) => setText(event.target.value)} />
          <div className="flex gap-2">
            <Field aria-label="Desde" type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
            <Field aria-label="Hasta" type="date" value={to} onChange={(event) => setTo(event.target.value)} />
          </div>
          <Button type="button" variant="soft" disabled={shownUnread.length === 0} onClick={() => void mark(shownUnread)}>
            Marcar leídas
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
          {items == null || syncedAt == null ? (
            <p className="text-sm text-muted">{SIN_DATOS}</p>
          ) : shown.length === 0 && undated.length === 0 ? (
            <p className="text-sm text-muted">{items.length === 0 ? "Sin notificaciones" : "Ninguna con este filtro"}</p>
          ) : (
            <ul className="space-y-2">
              {shown.map((row) => {
                const item = items.find((entry) => entry.key === row.key);
                if (!item) return null;
                return (
                  <li key={item.key} className="rounded-lg border border-line px-3 py-2 text-sm">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-medium">{item.labels.title}{item.seen ? "" : " · nueva"}</p>
                      <span className="shrink-0 text-xs text-muted">{item.labels.when}</span>
                    </div>
                    <p className="mt-1 text-muted">{item.labels.body}</p>
                    {item.labels.amount ? <p className="mt-1 tabular-nums">{item.labels.amount}</p> : null}
                    <div className="mt-2 flex gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        disabled={item.labels.destination === "none"}
                        onClick={() => onOpenThread?.({ creatorId, fanKey: item.fanKey, threadKey: item.threadKey })}
                      >
                        {item.labels.destination === "none" ? SIN_DATOS : "Abrir"}
                      </Button>
                      {!item.seen ? (
                        <Button type="button" variant="ghost" onClick={() => void mark([item.key])}>Marcar leída</Button>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {undated.length > 0 ? (
            <div className="mt-4">
              <p className="text-xs text-muted">Sin fecha. No entran en el rango, pero siguen aquí.</p>
              <ul className="mt-2 space-y-2">
                {undated.map((row) => {
                  const item = items?.find((entry) => entry.key === row.key);
                  if (!item) return null;
                  return (
                    <li key={item.key} className="rounded-lg border border-line px-3 py-2 text-sm">
                      <p className="font-medium">{item.labels.title}</p>
                      <p className="mt-1 text-muted">{item.labels.body}</p>
                      <p className="mt-1 text-xs text-muted">{SIN_DATOS}</p>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
          {nextCursor ? (
            <Button type="button" variant="soft" className="mt-3" onClick={onMore}>Más</Button>
          ) : null}
        </div>
      </aside>
    </div>
  );
}

function asRecord(creatorId: string, item: NotificationListItem): NotificationRecord {
  return {
    creatorId,
    key: item.key,
    kind: item.kind,
    body: item.body,
    fanKey: item.fanKey,
    fanName: item.fanName,
    threadKey: item.threadKey,
    amountCents: item.amountCents,
    occurredAt: item.occurredAt,
    pending: item.pending,
    seenAt: item.seen ? item.occurredAt ?? item.key : null,
  };
}
