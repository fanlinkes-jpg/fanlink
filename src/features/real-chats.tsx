import { useEffect, useState } from "react";
import { listCreatorChats, syncCreatorChats, type CreatorChatList } from "@/lib/of-sessions";
import { useCrm } from "@/lib/crm";
import { sessionErrorText } from "@/lib/use-creator-sessions";

export function RealChatsPage() {
  const creators = useCrm((s) => s.creators);
  const creatorId = useCrm((s) => s.creatorId);
  const teamAccess = useCrm((s) => s.teamAccess);
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
