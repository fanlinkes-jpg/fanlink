import { useEffect, useState } from "react";
import { listCreatorChats, syncCreatorChats, type CreatorChatList, type CreatorReadView } from "@/lib/of-sessions";
import { fanProfiles } from "@/lib/fan-metrics";
import { useCrm } from "@/lib/crm";
import { sessionErrorText } from "@/lib/use-creator-sessions";
import { useOfReads } from "@/lib/use-of-reads";

export function RealChatsPage() {
  const creators = useCrm((s) => s.creators);
  const creatorId = useCrm((s) => s.creatorId);
  const crmFans = useCrm((s) => s.fans);
  const teamAccess = useCrm((s) => s.teamAccess);
  const reads = useOfReads();
  const [data, setData] = useState<CreatorChatList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

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
    const timer = setInterval(() => void refresh(), 15_000);
    return () => clearInterval(timer);
  }, []);

  const threads = (data?.threads ?? []).filter(
    (thread) => creatorId === "all" || thread.creatorId === creatorId,
  );
  const selected =
    threads.find((thread) => `${thread.creatorId}:${thread.threadKey}` === selectedKey) ?? threads[0] ?? null;
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
          <p className="text-xs text-[#6d7585]">Lectura de lo guardado. Abrir esta pantalla no sincroniza ni envía.</p>
        </div>
        {error ? <p className="px-4 text-sm text-[#8a5a12]">{error}</p> : null}
        {threads.length === 0 ? (
          <p className="px-4 py-8 text-sm text-[#6d7585]">Sin sincronizar</p>
        ) : (
          <ul className="min-h-0 flex-1 overflow-y-auto">
            {threads.map((thread) => (
              <li key={`${thread.creatorId}:${thread.threadKey}`}>
                <button
                  type="button"
                  onClick={() => setSelectedKey(`${thread.creatorId}:${thread.threadKey}`)}
                  className={`block w-full px-4 py-3 text-left ${selected?.threadKey === thread.threadKey ? "bg-[#f4f6fb]" : ""}`}
                >
                  <span className="block font-medium">{thread.fanName ?? thread.fanHandle ?? "Fan"}</span>
                  <span className="block truncate text-xs text-[#6d7585]">
                    {creators.find((creator) => creator.id === thread.creatorId)?.name ?? thread.creatorId}
                    {thread.excerpt ? ` · ${thread.excerpt}` : ""}
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
                  reads={reads.byCreator}
                  crmFans={crmFans}
                  ppvSynced={meta?.status === "ok"}
                />
                <p className="text-xs text-[#6d7585]">
                  {running ? "En curso" : meta?.status === "error" ? `Error · ${shortReason(meta.reason)}` : meta?.status === "ok" ? "OK" : "Sin sincronizar"}
                  {meta?.syncedAt ? ` · ${syncAge(meta.syncedAt)}` : ""}
                </p>
              </div>
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
                  <p className="mt-1 text-[10px] text-[#6d7585]">{message.sentAt.slice(0, 16).replace("T", " ")}</p>
                </li>
              ))}
            </ol>
            <p className="border-t border-[#e6e8ee] px-4 py-3 text-xs text-[#6d7585]">Lectura. No se envía nada a OnlyFans.</p>
          </>
        ) : (
          <p className="p-6 text-sm text-[#6d7585]">Sin sincronizar</p>
        )}
      </section>
    </div>
  );
}

const SEGMENT_LABEL: Record<"whale" | "risk" | "asleep" | "new", string> = {
  whale: "ballena",
  risk: "riesgo",
  asleep: "dormido",
  new: "nuevo",
};

function FanFacts({
  creatorId,
  fanKey,
  fanHandle,
  fanName,
  reads,
  crmFans,
  ppvSynced,
}: {
  creatorId: string;
  fanKey: string | null;
  fanHandle: string | null;
  fanName: string | null;
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
  const spend = profile?.ltvCents ?? ofFan?.spentCents ?? null;
  const segments = profile?.segments.map((segment) => SEGMENT_LABEL[segment]) ?? [];
  return (
    <p className="text-xs text-[#6d7585]">
      Gasto {spend == null ? "Sin datos" : `${(spend / 100).toFixed(2)} USD`}
      {" · "}
      Segmento {segments.length ? segments.join(", ") : "Sin datos"}
      {" · "}
      Notas {note || "Sin datos"}
    </p>
  );
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
