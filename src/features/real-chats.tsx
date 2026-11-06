import { useEffect, useState } from "react";
import { listCreatorChats, recordChatOutbound, syncCreatorChats, type CreatorChatList, type CreatorReadView } from "@/lib/of-sessions";
import { campaignSendFlag } from "@/lib/of-campaigns";
import { useCrm } from "@/lib/crm";
import { sessionErrorText } from "@/lib/use-creator-sessions";
import { useOfReads } from "@/lib/use-of-reads";
import { FanInsights } from "@/features/fan-insights";

const EMOJIS = ["😊", "🔥", "❤️", "😘", "🎁"];

export function RealChatsPage() {
  const creators = useCrm((s) => s.creators);
  const creatorId = useCrm((s) => s.creatorId);
  const setCreator = useCrm((s) => s.setCreator);
  const crmFans = useCrm((s) => s.fans);
  const saveNote = useCrm((s) => s.saveNote);
  const teamAccess = useCrm((s) => s.teamAccess);
  const reads = useOfReads();
  const [data, setData] = useState<CreatorChatList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [filter, setFilter] = useState<"todos" | "propinas" | "online">("todos");
  const [insightsOpen, setInsightsOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const [draft, setDraft] = useState("");
  const [sendEnabled, setSendEnabled] = useState(false);
  const [pendingOut, setPendingOut] = useState<Array<{ id: string; threadKey: string; body: string }>>([]);

  async function refresh() {
    try {
      setData(await listCreatorChats());
      setError(null);
    } catch (err) {
      setError(sessionErrorText(err));
    }
  }

  useEffect(() => {
    void refresh();
    void campaignSendFlag().then((flag) => setSendEnabled(flag.sendEnabled)).catch(() => setSendEnabled(false));
  }, []);

  const threads = (data?.threads ?? []).filter(
    (thread) => creatorId === "all" || thread.creatorId === creatorId,
  );
  const knowsOnline = threads.some((thread) => thread.online != null);
  const visible = [...threads]
    .filter((thread) => filter !== "propinas" || (thread.tipsCents != null && thread.tipsCents > 0))
    .filter((thread) => filter !== "online" || thread.online === true)
    .sort((left, right) => (right.lastMessageAt ?? "").localeCompare(left.lastMessageAt ?? ""));
  const selected =
    visible.find((thread) => `${thread.creatorId}:${thread.threadKey}` === selectedKey) ?? visible[0] ?? null;
  const messages = (data?.messages ?? [])
    .filter((message) => message.creatorId === selected?.creatorId && message.threadKey === selected?.threadKey)
    .sort((left, right) => left.sentAt.localeCompare(right.sentAt));
  const meta = data?.meta.find((item) => item.creatorId === selected?.creatorId);
  const running = selected ? data?.runningCreatorIds.includes(selected.creatorId) : false;
  const canForce = teamAccess?.role === "owner" && selected != null;
  useEffect(() => {
    const params = new URLSearchParams();
    if (selected?.creatorId) params.set("creatorId", selected.creatorId);
    if (selected?.threadKey) params.set("threadKey", selected.threadKey);
    const source = new EventSource(`/api/chat-live?${params.toString()}`);
    source.addEventListener("chats", () => {
      void refresh();
    });
    return () => source.close();
  }, [selected?.creatorId, selected?.threadKey]);
  const creatorName = creatorId === "all"
    ? "Todas las cuentas"
    : creators.find((creator) => creator.id === creatorId)?.name ?? "Cuenta";
  const unread = threads.reduce((sum, thread) => sum + thread.unread, 0);

  return (
    <div className="flex h-full min-h-0 bg-white text-[#1c2333]">
      <section className="flex w-full min-w-0 flex-col border-r border-[#e6e8ee] md:w-[340px]">
        <div className="space-y-3 border-b border-[#e6e8ee] px-3 py-3">
          <h1 className="truncate text-sm font-semibold uppercase tracking-wide">{creatorName}</h1>
          <div className="flex gap-2">
            {knowsOnline ? (
              <button type="button" onClick={() => setFilter(filter === "online" ? "todos" : "online")} className={`rounded-lg px-3 py-1.5 text-xs font-medium ${filter === "online" ? "bg-[#3b6cff] text-white" : "bg-[#eef2ff] text-[#2456c7]"}`}>Fans en línea</button>
            ) : (
              <span className="rounded-lg bg-[#f3f4f6] px-3 py-1.5 text-xs text-[#6d7585]">Fans en línea: Sin datos</span>
            )}
            <span className="rounded-lg bg-[#e8f8ef] px-3 py-1.5 text-xs text-[#137333]">Notificaciones {threads.length === 0 ? "Sin datos" : unread}</span>
          </div>
          <div className="flex items-center gap-2">
            <select value={creatorId} onChange={(event) => setCreator(event.target.value)} className="h-8 min-w-0 flex-1 rounded-lg border border-[#e6e8ee] px-2 text-xs" aria-label="Bandeja">
              <option value="all">Todas las bandejas</option>
              {creators.map((creator) => <option key={creator.id} value={creator.id}>{creator.name}</option>)}
            </select>
            <span className="shrink-0 text-[10px] text-[#6d7585]">Más recientes</span>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => setFilter("todos")} className={`rounded-full px-3 py-1 text-xs ${filter === "todos" ? "bg-[#3b6cff] text-white" : "bg-[#f3f4f6] text-[#6d7585]"}`}>Todos</button>
            <button type="button" onClick={() => setFilter("propinas")} className={`rounded-full px-3 py-1 text-xs ${filter === "propinas" ? "bg-[#3b6cff] text-white" : "bg-[#f3f4f6] text-[#6d7585]"}`}>Con propinas</button>
          </div>
        </div>
        {error ? <p className="px-4 text-sm text-[#8a5a12]">{error}</p> : null}
        {visible.length === 0 ? (
          <p className="px-4 py-8 text-sm text-[#6d7585]">{threads.length === 0 ? emptyChatsLabel(data) : "Sin datos"}</p>
        ) : (
          <ul className="min-h-0 flex-1 overflow-y-auto">
            {visible.map((thread) => (
              <li key={`${thread.creatorId}:${thread.threadKey}`}>
                <button
                  type="button"
                  onClick={() => setSelectedKey(`${thread.creatorId}:${thread.threadKey}`)}
                  className={`flex w-full gap-3 px-3 py-3 text-left ${selected?.threadKey === thread.threadKey && selected.creatorId === thread.creatorId ? "bg-[#f4f7ff]" : ""}`}
                >
                  <span className="flex w-12 shrink-0 flex-col items-center gap-1">
                    {thread.avatarUrl ? (
                      <img src={thread.avatarUrl} alt="" className="h-10 w-10 rounded-full object-cover" />
                    ) : (
                      <span className="grid h-10 w-10 place-items-center rounded-full bg-[#eef2ff] text-sm">{(thread.fanName ?? "F").slice(0, 1)}</span>
                    )}
                    <span className={`text-[10px] font-medium ${thread.spentCents == null ? "text-[#6d7585]" : "text-[#137333]"}`}>
                      {thread.spentCents == null ? "Sin datos" : `$${(thread.spentCents / 100).toFixed(2)}`}
                    </span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1">
                      <span className="truncate text-sm font-medium">{thread.fanName ?? "Fan"}</span>
                      {thread.unread > 0 ? <span className="rounded bg-[#e7f0ff] px-1 text-[10px] font-semibold text-[#2456c7]">NEW</span> : null}
                      {thread.online === false ? <span className="rounded bg-[#f3f4f6] px-1 text-[10px] text-[#6d7585]">OFF</span> : null}
                    </span>
                    <span className="block truncate text-xs text-[#6d7585]">{thread.fanHandle ? `@${thread.fanHandle.replace(/^@/, "")}` : "Sin datos"}</span>
                    <span className="mt-1 flex items-baseline justify-between gap-2 text-xs text-[#6d7585]">
                      <span className="truncate">{thread.excerpt ?? "Sin datos"}</span>
                      <span className="shrink-0">{thread.lastMessageAt ? thread.lastMessageAt.slice(11, 16) : "Sin datos"}</span>
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="hidden min-w-0 flex-1 flex-col md:flex">
        {selected ? (
          <>
            <header className="flex items-center justify-between gap-3 border-b border-[#e6e8ee] px-4 py-3">
              <p className="truncate font-medium">{selected.fanName ?? selected.fanHandle ?? "Fan"}</p>
              <div className="flex items-center gap-2">
                <button type="button" className="rounded-lg border border-[#e6e8ee] px-2 py-1 text-xs" onClick={() => void refresh()}>Recargar</button>
                <button type="button" className="rounded-lg border border-[#e6e8ee] px-2 py-1 text-xs xl:hidden" onClick={() => setInsightsOpen(true)}>Ficha</button>
                <button type="button" className="rounded-lg border border-[#e6e8ee] px-2 py-1 text-xs" onClick={() => setMenu((open) => !open)} aria-label="Menú">Menú</button>
              </div>
            </header>
            {menu ? (
              <div className="border-b border-[#e6e8ee] px-4 py-2 text-xs text-[#6d7585]">
                {running ? "En curso" : meta?.status === "error" ? `Error · ${shortReason(meta.reason)}` : meta?.status === "ok" ? "OK" : "Sin sincronizar"}
                {meta?.syncedAt ? ` · ${syncAge(meta.syncedAt)}` : ""}
                {canForce ? (
                  <button
                    type="button"
                    disabled={pending || running}
                    onClick={() => {
                      setPending(true);
                      void syncCreatorChats({ data: { creatorId: selected.creatorId } })
                        .then(() => refresh())
                        .catch((err: unknown) => setError(sessionErrorText(err)))
                        .finally(() => setPending(false));
                    }}
                    className="ml-3 rounded border border-[#e6e8ee] px-2 py-1 disabled:opacity-50"
                  >
                    {pending || running ? "Sincronizando…" : "Forzar sincronización"}
                  </button>
                ) : null}
              </div>
            ) : null}
            <ol className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
              {messages.length === 0 ? <li className="text-sm text-[#6d7585]">Sin datos</li> : null}
              {pendingOut.filter((item) => item.threadKey === selected.threadKey).map((item) => (
                <li key={item.id} className="text-right">
                  <p className="inline-block max-w-[70%] rounded-2xl border border-dashed border-[#c5cad6] px-3 py-2 text-sm">{item.body}</p>
                  <p className="mt-1 text-[10px] text-[#8a5a12]">Pendiente · no enviado</p>
                </li>
              ))}
              {messages.map((message) => (
                <li key={message.messageKey} className={message.fromFan ? "text-left" : "text-right"}>
                  <p className={`inline-block max-w-[70%] rounded-2xl px-3 py-2 text-sm ${message.fromFan ? "bg-[#f4f6fb]" : "bg-[#e7f0ff]"}`}>
                    {message.body}
                  </p>
                  <p className="mt-1 text-[10px] text-[#6d7585]">{messageCaption(message)}</p>
                </li>
              ))}
            </ol>
            <form className="border-t border-[#e6e8ee] p-3" onSubmit={(event) => event.preventDefault()}>
              <div className="mb-2 flex gap-1">
                {EMOJIS.map((emoji) => (
                  <button key={emoji} type="button" className="rounded px-1 text-base" onClick={() => setDraft((value) => `${value}${emoji}`)}>{emoji}</button>
                ))}
                <button type="button" disabled className="ml-auto rounded px-2 text-xs text-[#b0b6c2]" title="Sin datos">Traducción</button>
                <button type="button" disabled className="rounded px-2 text-xs text-[#b0b6c2]" title="Sin datos">Guiones</button>
                <button type="button" disabled className="rounded px-2 text-xs text-[#b0b6c2]" title="Sin datos">Galería</button>
              </div>
              <div className="flex items-end gap-2">
                <textarea value={draft} onChange={(event) => setDraft(event.target.value)} rows={2} placeholder="Escribe un mensaje" className="min-h-12 flex-1 resize-none rounded-xl border border-[#e6e8ee] px-3 py-2 text-sm" />
                <button
                  type="button"
                  disabled={!draft.trim()}
                  onClick={() => {
                    if (!selected || !draft.trim()) return;
                    const body = draft.trim();
                    setPendingOut((items) => [...items, { id: crypto.randomUUID(), threadKey: selected.threadKey, body }]);
                    setDraft("");
                    void recordChatOutbound({
                      data: {
                        creatorId: selected.creatorId,
                        fanKey: selected.fanKey,
                        threadKey: selected.threadKey,
                        body,
                        priceCents: null,
                        ofMessageKey: null,
                      },
                    }).catch((err: unknown) => setError(sessionErrorText(err)));
                  }}
                  className="rounded-full border border-[#e6e8ee] px-4 py-2 text-sm disabled:opacity-50"
                >
                  Dejar pendiente
                </button>
                <button type="button" disabled title="Envío real desactivado" className="rounded-full bg-[#d7dbe3] px-4 py-2 text-sm text-white">
                  {sendEnabled ? "Enviar" : "Envío real desactivado"}
                </button>
              </div>
            </form>
          </>
        ) : (
          <p className="p-6 text-sm text-[#6d7585]">Sin sincronizar</p>
        )}
      </section>
      <div className="hidden h-full w-[320px] shrink-0 border-l border-[#e6e8ee] xl:block">
        {selected ? <InsightPane thread={selected} reads={reads.byCreator} crmFans={crmFans} messages={messages} onNotes={saveNote} /> : null}
      </div>
      {insightsOpen && selected ? (
        <div className="fixed inset-0 z-40 bg-black/30 xl:hidden" onClick={() => setInsightsOpen(false)}>
          <div className="absolute inset-y-0 right-0 w-[min(100%,360px)] shadow-xl" onClick={(event) => event.stopPropagation()}>
            <InsightPane thread={selected} reads={reads.byCreator} crmFans={crmFans} messages={messages} onNotes={saveNote} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function InsightPane({
  thread,
  reads,
  crmFans,
  messages,
  onNotes,
}: {
  thread: {
    creatorId: string;
    fanKey: string | null;
    fanName: string | null;
    fanHandle: string | null;
    spentCents: number | null;
    tipsCents: number | null;
    subPriceCents: number | null;
    subExpiresAt: string | null;
    renewAuto: boolean | null;
  };
  reads: Map<string, CreatorReadView>;
  crmFans: Array<{ id: string; creatorId: string; handle: string; name: string; notes: string }>;
  messages: Array<{ fromFan: boolean; priceCents: number | null; purchased: boolean | null }>;
  onNotes: (fanId: string, notes: string) => void;
}) {
  const read = reads.get(thread.creatorId);
  const ofFan = read?.fans.find((fan) => fan.fanKey === thread.fanKey) ?? null;
  const crm = crmFans.find((fan) => {
    if (fan.creatorId !== thread.creatorId) return false;
    if (thread.fanHandle && fan.handle.replace(/^@/, "") === thread.fanHandle.replace(/^@/, "")) return true;
    return thread.fanName != null && fan.name === thread.fanName;
  });
  return (
    <FanInsights
      name={thread.fanName}
      handle={thread.fanHandle}
      spentCents={thread.spentCents ?? ofFan?.spentCents ?? null}
      tipsCents={thread.tipsCents}
      status={ofFan?.status ?? null}
      expiresAt={thread.subExpiresAt ?? ofFan?.expiresAt ?? null}
      subscribedAt={ofFan?.subscribedAt ?? null}
      renewAuto={thread.renewAuto ?? ofFan?.renewAuto ?? null}
      subPriceCents={thread.subPriceCents}
      notes={crm?.notes ?? ""}
      notesEditable={crm != null}
      onNotes={(value) => {
        if (crm) onNotes(crm.id, value);
      }}
      transactions={(read?.transactions ?? []).filter((row) => row.fanKey === thread.fanKey).map((row) => ({
        occurredAt: row.occurredAt,
        grossCents: row.grossCents,
        kind: row.kind,
      }))}
      ppvPrices={messages.flatMap((message) => (
        !message.fromFan && message.purchased === true && message.priceCents != null && message.priceCents > 0 ? [message.priceCents] : []
      ))}
    />
  );
}

function messageCaption(message: { sentAt: string; fromFan: boolean; authorName: string | null; automatic: boolean | null; seen: boolean | null }): string {
  const time = message.sentAt.slice(0, 16).replace("T", " ");
  const seen = message.seen == null ? "" : message.seen ? " · ✓" : "";
  if (message.fromFan) return `${time}${seen}`;
  const who = message.automatic ? "Mensaje automático" : message.authorName ?? "Cuenta";
  return `${time}${seen} · ${who}`;
}

function emptyChatsLabel(data: CreatorChatList | null): string {
  if (data?.meta.some((item) => item.status === "error")) {
    const reason = data.meta.find((item) => item.status === "error")?.reason;
    return reason ? `Error · ${shortReason(reason)}` : "Error";
  }
  if (data?.meta.some((item) => item.status === "ok")) return "Sin conversaciones";
  return "Sin sincronizar";
}

function shortReason(reason: string | null | undefined): string {
  if (!reason) return "error";
  const cut = reason.split(". json:")[0] ?? reason;
  const text = cut.replace(/https?:\/\/\S+/g, "").replace(/\s+/g, " ").trim();
  if (/redirigido a login/i.test(text)) return "OnlyFans pide iniciar sesión: pulsa Reconectar";
  return text;
}

function syncAge(iso: string): string {
  const mins = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 60_000));
  if (mins < 1) return "Última sincronización: hace menos de 1 min";
  return `Última sincronización: hace ${mins} min`;
}
