import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { Button, Field } from "@/components/ui";
import {
  filterNotifications,
  notificationBellCount,
  NOTIFICATION_TABS,
  TAB_LABEL,
  SIN_DATOS,
  type NotificationCounts,
  type NotificationRecord,
  type NotificationTab,
} from "@/lib/notifications";
import { listCreatorNotifications, markCreatorNotificationsRead, type NotificationListItem } from "@/lib/of-notifications";
import { NotificationFanCard } from "@/features/notification-card";

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
  const [counts, setCounts] = useState<NotificationCounts | null>(null);
  const [motivo, setMotivo] = useState<string | null>(null);
  const [markOnOnlyfans, setMarkOnOnlyfans] = useState(false);
  const [fanlinkUnread, setFanlinkUnread] = useState<number | null>(null);

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
        setCounts(data.counts);
        setMotivo(data.motivo);
        setMarkOnOnlyfans(data.markOnOnlyfans);
        setFanlinkUnread(data.fanlinkUnread);
      } catch {
        if (!stop) {
          setItems(null);
          setFanlinkUnread(null);
          setMotivo("no se pudo leer");
        }
      }
    }
    void pull();
    const timer = setInterval(() => void pull(), 15_000);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, [creatorId]);

  async function acknowledge(keys: string[] | null) {
    const data = await markCreatorNotificationsRead({ data: { creatorId, keys } });
    if (data.counts) setCounts(data.counts);
    if (data.motivo) setMotivo(data.motivo);
    setMarkOnOnlyfans(data.markOnOnlyfans);
    setFanlinkUnread(data.fanlinkUnread);
    const chosen = new Set(data.keys);
    setItems((current) => (current ?? []).map((item) => (
      chosen.has(item.key) ? { ...item, seen: true, ofUnread: data.cleared ? false : item.ofUnread } : item
    )));
  }

  async function loadMore() {
    if (!nextCursor) return;
    const data = await listCreatorNotifications({ data: { creatorId, cursor: nextCursor } });
    setItems((current) => [...(current ?? []), ...data.items]);
    setNextCursor(data.nextCursor);
  }

  const bell = notificationBellCount({
    markOnOnlyfans,
    counts: items == null ? null : counts,
    fanlinkTotal: items == null ? null : fanlinkUnread,
    role,
  });

  return (
    <>
      <button
        type="button"
        aria-label={bellLabel(bell, motivo)}
        onClick={() => {
          setOpen(true);
          void acknowledge(null);
        }}
        className="relative grid h-8 w-8 place-items-center rounded-lg border border-line bg-surface text-fg"
      >
        <Bell className="h-4 w-4" />
        {bell.count == null ? (
          <span className="absolute -top-2 -right-2 rounded bg-raised px-1 text-[9px] text-muted">{SIN_DATOS}</span>
        ) : bell.count > 0 ? (
          <span className="absolute -top-1 -right-1 min-w-4 rounded-full bg-danger px-1 text-[10px] font-semibold text-white">{bell.count}</span>
        ) : null}
      </button>
      {open ? (
        <NotificationPanel
          creatorId={creatorId}
          role={role}
          items={items}
          syncedAt={syncedAt}
          counts={counts}
          motivo={motivo}
          onClose={() => setOpen(false)}
          onChanged={setItems}
          onOpenThread={onOpenThread}
          nextCursor={nextCursor}
          onMore={() => void loadMore()}
          onMark={(keys) => void acknowledge(keys)}
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
  counts,
  motivo,
  onClose,
  onChanged,
  onOpenThread,
  nextCursor,
  onMore,
  onMark,
}: {
  creatorId: string;
  role: "owner" | "member" | null;
  items: NotificationListItem[] | null;
  syncedAt: string | null;
  counts: NotificationCounts | null;
  motivo: string | null;
  onClose: () => void;
  onChanged: (items: NotificationListItem[]) => void;
  onOpenThread?: (target: NotificationTarget) => void;
  nextCursor: string | null;
  onMore: () => void;
  onMark: (keys: string[] | null) => void;
}) {
  const [tab, setTab] = useState<NotificationTab>("all");
  const [text, setText] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const records = (items ?? []).map((item) => asRecord(creatorId, item));
  const filtered = filterNotifications(records, { tab, text, from, to });
  const shown = filtered.rows;
  const undated = filtered.undated;
  const shownUnread = [...shown, ...undated].flatMap((row) => {
    const item = (items ?? []).find((entry) => entry.key === row.key);
    return item && fresh(item) ? [row.key] : [];
  });

  function mark(keys: string[]) {
    if (keys.length === 0) return;
    onMark(keys);
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30">
      <button className="absolute inset-0" aria-label="Cerrar notificaciones" onClick={onClose} />
      <aside className="relative flex h-full w-full max-w-md flex-col bg-surface shadow-xl">
        <header className="flex items-center justify-between border-b border-line px-4 py-3">
          <div>
            <h2 className="font-display text-base font-semibold">Notificaciones</h2>
            <p className="text-xs text-muted">{role === "owner" ? "Dueña" : role === "member" ? "Chatter" : SIN_DATOS} · {statusLine(motivo, syncedAt)}</p>
          </div>
          <Button type="button" variant="ghost" onClick={onClose}>Cerrar</Button>
        </header>
        <div className="space-y-3 border-b border-line px-4 py-3">
          <div className="flex flex-wrap gap-1">
            {NOTIFICATION_TABS.map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={`whitespace-nowrap rounded-md px-2 py-1 text-xs ${tab === id ? "bg-primary text-primary-fg" : "bg-raised text-muted"}`}
              >
                {TAB_LABEL[id]} {pillCount(counts, id)}
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
          {items == null ? (
            <p className="text-sm text-muted">{motivo && motivo !== "ok" ? motivoVisible(motivo) : SIN_DATOS}</p>
          ) : shown.length === 0 && undated.length === 0 ? (
            <p className="text-sm text-muted">{emptyLine(items.length, motivo, counts?.all ?? null)}</p>
          ) : (
            <ul className="space-y-2">
              {shown.map((row) => {
                const item = items.find((entry) => entry.key === row.key);
                if (!item) return null;
                return (
                  <li key={item.key} className="rounded-lg border border-line px-3 py-2">
                    <NotificationFanCard
                      item={item}
                      handle={item.fanHandle}
                      avatarUrl={item.avatarUrl}
                      lists={item.lists}
                      renew={item.renewAuto}
                      onChat={item.labels.destination === "none" ? undefined : () => onOpenThread?.({ creatorId, fanKey: item.fanKey, threadKey: item.threadKey })}
                      onMark={fresh(item) ? () => void mark([item.key]) : undefined}
                    />
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
                    <li key={item.key} className="rounded-lg border border-line px-3 py-2">
                      <NotificationFanCard
                        item={item}
                        handle={item.fanHandle}
                        avatarUrl={item.avatarUrl}
                        lists={item.lists}
                        renew={item.renewAuto}
                      />
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
    ofUnread: item.ofUnread,
  };
}

function fresh(item: NotificationListItem): boolean {
  if (item.seen) return false;
  return item.ofUnread !== false;
}

function pillCount(counts: NotificationCounts | null, id: NotificationTab): string {
  if (!counts || counts[id] == null) return SIN_DATOS;
  return String(counts[id]);
}

function bellLabel(bell: { count: number | null; source: "onlyfans" | "fanlink" }, motivo: string | null): string {
  const where = bell.source === "onlyfans" ? "OnlyFans" : "Fanlink";
  if (bell.count == null) return `Notificaciones de ${where}, ${motivo && motivo !== "ok" ? motivoVisible(motivo) : SIN_DATOS}`;
  return `Notificaciones de ${where}, ${bell.count} sin leer`;
}

function statusLine(motivo: string | null, syncedAt: string | null): string {
  if (motivo && motivo !== "ok") return motivoVisible(motivo);
  if (!syncedAt) return SIN_DATOS;
  return "centro de notificaciones de esta cuenta";
}

function emptyLine(stored: number, motivo: string | null, unread: number | null): string {
  if (motivo && motivo !== "ok" && motivo !== "sin notificaciones") return motivoVisible(motivo);
  if (stored === 0 && unread != null && unread > 0) return "No se pudo leer";
  if (motivo === "sin notificaciones" || stored === 0) return "Sin notificaciones";
  return "Ninguna con este filtro";
}

function motivoVisible(motivo: string): string {
  switch (motivo) {
    case "firma rechazada":
      return "Firma rechazada";
    case "no se pudo leer":
      return "No se pudo leer";
    case "sin notificaciones":
      return "Sin notificaciones";
    case "sesión caída":
      return "Sesión caída";
    default:
      return motivo.startsWith("se omite") ? motivo : "No se pudo leer";
  }
}
