import { useEffect, useState } from "react";
import { listCreatorChats, syncCreatorChats, type CreatorChatList, type CreatorReadView } from "@/lib/of-sessions";
import { fanProfiles } from "@/lib/fan-metrics";
import { useCrm } from "@/lib/crm";
import { sessionErrorText } from "@/lib/use-creator-sessions";
import { useOfReads } from "@/lib/use-of-reads";
import { FanInsights } from "@/features/fan-insights";

export function RealChatsPage() {
  const creatorId = useCrm((s) => s.creatorId);
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
    const source = new EventSource("/api/chat-live");
    source.addEventListener("chats", () => {
      void refresh();
    });
    return () => source.close();
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
  const messages = (data?.messages ?? []).filter(
    (message) => message.creatorId === selected?.creatorId && message.threadKey === selected?.threadKey,
  );
  const meta = data?.meta.find((item) => item.creatorId === selected?.creatorId);
  const running = selected ? data?.runningCreatorIds.includes(selected.creatorId) : false;
  const canForce = teamAccess?.role === "owner" && selected != null;

  return (
    <div className="flex h-full min-h-0 bg-white text-[#1c2333]">
      <section className="flex w-full min-w-0 flex-col border-r border-[#e6e8ee] md:w-[340px]">
        <div className="px-4 py-3">
          <h1 className="text-lg font-semibold">Chat</h1>
          <p className="text-xs text-[#6d7585]">Más recientes. Abrir esta pantalla no envía.</p>
          <div className="mt-2 flex flex-wrap gap-1">
            {([["todos", "Todos"], ["propinas", "Con propinas"]] as const).map(([id, label]) => (
              <button key={id} type="button" onClick={() => setFilter(id)} className={`rounded-full px-2 py-1 text-xs ${filter === id ? "bg-[#e7f0ff] text-[#2456c7]" : "text-[#6d7585]"}`}>{label}</button>
            ))}
            {knowsOnline ? (
              <button type="button" onClick={() => setFilter("online")} className={`rounded-full px-2 py-1 text-xs ${filter === "online" ? "bg-[#e7f0ff] text-[#2456c7]" : "text-[#6d7585]"}`}>Fans en línea</button>
            ) : (
              <span className="rounded-full px-2 py-1 text-xs text-[#6d7585]">Fans en línea: Sin datos</span>
            )}
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
                  className={`flex w-full gap-3 px-4 py-3 text-left ${selected?.threadKey === thread.threadKey ? "bg-[#f4f6fb]" : ""}`}
                >
                  {thread.avatarUrl ? (
                    <img src={thread.avatarUrl} alt="" className="h-10 w-10 rounded-full object-cover" />
                  ) : (
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#eef2ff] text-sm">{(thread.fanName ?? "F").slice(0, 1)}</span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="truncate font-medium">{thread.fanName ?? thread.fanHandle ?? "Fan"}</span>
                      <span className="shrink-0 text-[10px] text-[#6d7585]">{thread.lastMessageAt ? thread.lastMessageAt.slice(11, 16) : "Sin datos"}</span>
                    </span>
                    <span className="block truncate text-xs text-[#6d7585]">{thread.fanHandle ? `@${thread.fanHandle.replace(/^@/, "")}` : "Sin datos"} · {thread.spentCents == null ? "Sin datos" : `${(thread.spentCents / 100).toFixed(2)} USD`}</span>
                    <span className="block truncate text-xs text-[#6d7585]">
                      {previewLabel(thread)}
                      {thread.excerpt ? `${previewLabel(thread) ? " · " : ""}${thread.excerpt}` : ""}
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
              <div>
                <p className="font-medium">{selected.fanName ?? selected.fanHandle}</p>
                <FanFacts
                  creatorId={selected.creatorId}
                  fanKey={selected.fanKey}
                  fanHandle={selected.fanHandle}
                  fanName={selected.fanName}
                  threadSpend={selected}
                  reads={reads.byCreator}
                  crmFans={crmFans}
                  ppvSynced={meta?.status === "ok"}
                />
                <p className="text-xs text-[#6d7585]">
                  {running ? "En curso" : meta?.status === "error" ? `Error · ${shortReason(meta.reason)}` : meta?.status === "ok" ? "OK" : "Sin sincronizar"}
                  {meta?.syncedAt ? ` · ${syncAge(meta.syncedAt)}` : ""}
                </p>
              </div>
              <button type="button" className="rounded-lg border border-[#e6e8ee] px-2 py-1 text-xs xl:hidden" onClick={() => setInsightsOpen(true)}>Ficha</button>
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
                  className="rounded-lg border border-[#e6e8ee] px-2 py-1 text-xs disabled:opacity-50"
                >
                  {pending || running ? "Sincronizando…" : "Forzar sincronización"}
                </button>
              ) : null}
            </header>
            <ol className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-4">
              {messages.map((message) => (
                <li key={message.messageKey} className={message.fromFan ? "text-left" : "text-right"}>
                  <p className={`inline-block max-w-[70%] rounded-2xl px-3 py-2 text-sm ${message.fromFan ? "bg-[#f4f6fb]" : "bg-[#e7f0ff]"}`}>
                    {message.body}
                    {message.priceCents != null ? ` · ${(message.priceCents / 100).toFixed(2)}` : ""}
                    {message.purchased === true ? " · comprado" : message.purchased === false ? " · no comprado" : ""}
                  </p>
                  <p className="mt-1 text-[10px] text-[#6d7585]">{messageCaption(message)}</p>
                </li>
              ))}
            </ol>
            <p className="border-t border-[#e6e8ee] px-4 py-3 text-xs text-[#6d7585]">Lectura. No se envía nada a OnlyFans.</p>
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
  const seen = message.seen == null ? "" : message.seen ? " · Visto" : " · No visto";
  if (message.fromFan) return `${time}${seen}`;
  const who = message.automatic ? "Mensaje automático" : message.authorName ?? "Cuenta";
  return `${time} · ${who}${seen}`;
}

const SEGMENT_LABEL: Record<"whale" | "risk" | "asleep" | "new", string> = {
  whale: "ballena",
  risk: "riesgo",
  asleep: "dormido",
  new: "nuevo",
};

function previewLabel(thread: { lastFromFan: boolean | null; fanName: string | null }): string {
  if (thread.lastFromFan === true) return thread.fanName ?? "Fan";
  if (thread.lastFromFan === false) return "Tú";
  return "";
}

function FanFacts({
  creatorId,
  fanKey,
  fanHandle,
  fanName,
  threadSpend,
  reads,
  crmFans,
  ppvSynced,
}: {
  creatorId: string;
  fanKey: string | null;
  fanHandle: string | null;
  fanName: string | null;
  threadSpend: {
    spentCents: number | null;
    subscribesCents: number | null;
    tipsCents: number | null;
    postsCents: number | null;
    messagesCents: number | null;
  };
  reads: Map<string, CreatorReadView>;
  crmFans: Array<{ creatorId: string; handle: string; name: string; notes: string }>;
  ppvSynced: boolean;
}) {
  const ofFan = reads.get(creatorId)?.fans.find((fan) => fan.fanKey === fanKey) ?? null;
  const note = crmFans.find((fan) => {
    if (fan.creatorId !== creatorId) return false;
    if (fanHandle && fan.handle.replace(/^@/, "") === fanHandle.replace(/^@/, "")) return true;
    return fanName != null && fan.name === fanName;
  })?.notes.trim() ?? "";
  const profile = ofFan
    ? fanProfiles({
        now: new Date(),
        ppvSynced,
        fans: [{
          fanKey: ofFan.fanKey,
          name: ofFan.displayName ?? ofFan.handle,
          status: ofFan.status,
          subscribedAt: ofFan.subscribedAt,
          renewAuto: ofFan.renewAuto,
          spentCents: ofFan.spentCents,
          lastInteractionAt: null,
        }],
        purchases: (reads.get(creatorId)?.transactions ?? []).filter((row) => row.fanKey === ofFan.fanKey),
        ppv: [],
      })[0]
    : null;
  const spend = threadSpend.spentCents ?? profile?.ltvCents ?? ofFan?.spentCents ?? null;
  const segments = profile?.segments.map((segment) => SEGMENT_LABEL[segment]) ?? [];
  const parts = [
    ["suscripciones", threadSpend.subscribesCents],
    ["propinas", threadSpend.tipsCents],
    ["posts", threadSpend.postsCents],
    ["mensajes", threadSpend.messagesCents],
  ].filter((part): part is [string, number] => part[1] != null);
  return (
    <p className="text-xs text-[#6d7585]">
      Gasto {spend == null ? "Sin datos" : `${(spend / 100).toFixed(2)} USD`}
      {parts.length ? ` (${parts.map(([label, cents]) => `${label} ${(cents / 100).toFixed(2)}`).join(", ")})` : ""}
      {" · "}
      Segmento {segments.length ? segments.join(", ") : "Sin datos"}
      {" · "}
      Notas {note || "Sin datos"}
    </p>
  );
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
