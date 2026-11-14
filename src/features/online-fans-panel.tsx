import { useMemo, useState } from "react";
import { MessageCircle, RefreshCw } from "lucide-react";
import { fanInitials, filterOnlineFans, onlineListNames, spendLabel, type OnlineFanRow } from "@/lib/online-fan-row";

export type OnlineBroadcastPayload = {
  fanKeys: string[];
  text: string;
  priceCents: number | null;
  vaultItemIds: string[];
};

export type OnlineBroadcastProgress = {
  posted: number;
  results: Array<{ fanKey: string; status: "enviado" | "fallido"; reason: string | null }>;
  stopped: boolean;
  retryAfter: number | null;
  reason: string | null;
};

export function OnlineFansPanel({
  busy,
  note,
  fans,
  sendEnabled,
  sendReason,
  onRefresh,
  onOpenChat,
  onSend,
}: {
  busy: boolean;
  note: string | null;
  fans: OnlineFanRow[];
  sendEnabled: boolean;
  sendReason: string | null;
  onRefresh: () => void;
  onOpenChat: (fanKey: string) => void;
  onSend: (payload: OnlineBroadcastPayload) => Promise<OnlineBroadcastProgress>;
}) {
  const [list, setList] = useState("Todos");
  const [draft, setDraft] = useState("");
  const [price, setPrice] = useState("");
  const [vault, setVault] = useState("");
  const [composing, setComposing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState<OnlineBroadcastProgress | null>(null);
  const lists = useMemo(() => onlineListNames(fans), [fans]);
  const visible = filterOnlineFans(fans, lists.includes(list) || list === "Todos" ? list : "Todos");
  const names = new Map(fans.map((fan) => [fan.fanKey, fan.fanName ?? fan.fanHandle ?? fan.fanKey]));

  async function confirmSend() {
    setSending(true);
    try {
      const result = await onSend({
        fanKeys: visible.map((fan) => fan.fanKey),
        text: draft,
        priceCents: priceCents(price),
        vaultItemIds: vault.split(/[,;\s]+/).map((item) => item.trim()).filter(Boolean),
      });
      setProgress(result);
      setConfirming(false);
    } catch (err) {
      const reason = err instanceof Error && err.message ? err.message : "No se pudo leer.";
      setProgress({ posted: 0, results: [], stopped: false, retryAfter: null, reason });
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="absolute left-0 top-full z-30 mt-1 flex max-h-[28rem] w-[22rem] flex-col overflow-hidden rounded-xl border border-[#e6e8ee] bg-white shadow-lg">
      <div className="flex items-center gap-2 border-b border-[#e6e8ee] px-3 py-2">
        <p className="min-w-0 flex-1 text-[11px] uppercase tracking-wide text-[#6d7585]">Colecciones · Todo · En línea</p>
        <button type="button" aria-label="Actualizar fans en línea" className="rounded-md p-1 text-[#2456c7] hover:bg-[#eef2ff]" onClick={onRefresh}>
          <RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} />
        </button>
      </div>
      <div className="flex items-center gap-2 px-3 py-2">
        <label className="sr-only" htmlFor="online-fan-list">Lista</label>
        <select
          id="online-fan-list"
          value={lists.includes(list) || list === "Todos" ? list : "Todos"}
          onChange={(event) => { setList(event.target.value); setConfirming(false); }}
          className="rounded-full border border-[#d5def8] bg-[#eef2ff] px-3 py-1 text-xs font-medium text-[#2456c7]"
        >
          <option value="Todos">Todos</option>
          {lists.map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
        <span className="text-[11px] text-[#6d7585]">{visible.length}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {busy ? <p className="px-3 py-3 text-xs text-[#6d7585]">Leyendo Colecciones, pestaña Todo, filtro En línea…</p> : null}
        {!busy && note ? <p className="px-3 py-2 text-xs text-[#6d7585]">{note}</p> : null}
        {visible.map((fan) => (
          <div key={fan.fanKey} className="flex items-center gap-2 px-3 py-2">
            <span className="relative h-8 w-8 shrink-0">
              {fan.avatarUrl ? (
                <img src={fan.avatarUrl} alt="" className="h-8 w-8 rounded-full object-cover" />
              ) : (
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#e8eefc] text-[11px] font-semibold text-[#2456c7]">{fanInitials(fan.fanName, fan.fanHandle)}</span>
              )}
              <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border border-white bg-[#1f9d55]" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{fan.fanName ?? fan.fanHandle ?? "Sin datos"}</span>
              <span className="block truncate text-[11px] text-[#6d7585]">{spendLabel(fan.spentCents)}</span>
            </span>
            <button type="button" aria-label={`Abrir chat de ${fan.fanName ?? fan.fanHandle ?? "fan"}`} className="rounded-md p-1 text-[#2456c7] hover:bg-[#eef2ff]" onClick={() => onOpenChat(fan.fanKey)}>
              <MessageCircle className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
      <div className="space-y-2 border-t border-[#e6e8ee] px-3 py-2">
        {sendEnabled && composing ? (
          <>
            <textarea value={draft} onChange={(event) => { setDraft(event.target.value); setConfirming(false); }} rows={3} placeholder="Mensaje" className="w-full resize-none rounded-lg border border-[#e6e8ee] px-2 py-1.5 text-sm" />
            <input value={price} onChange={(event) => { setPrice(event.target.value); setConfirming(false); }} inputMode="decimal" placeholder="Precio por fan, opcional" aria-label="Precio por fan" className="w-full rounded-lg border border-[#e6e8ee] px-2 py-1.5 text-sm" />
            <input value={vault} onChange={(event) => { setVault(event.target.value); setConfirming(false); }} placeholder="Ids de la bóveda, opcional" aria-label="Ids de la bóveda" className="w-full rounded-lg border border-[#e6e8ee] px-2 py-1.5 text-sm" />
            <p className="text-[11px] text-[#6d7585]">{visible.length === 0 ? "Nadie en esta lista" : `Destinatarios: ${visible.length}`}</p>
            {confirming ? (
              <div className="space-y-2">
                <p className="text-xs">Vas a escribir a {visible.length} fans en línea.</p>
                <div className="flex gap-2">
                  <button type="button" disabled={sending || visible.length === 0} className="rounded-lg bg-[#3b6cff] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50" onClick={() => void confirmSend()}>{sending ? "Enviando…" : "Confirmar"}</button>
                  <button type="button" className="rounded-lg px-3 py-1.5 text-xs text-[#6d7585]" onClick={() => setConfirming(false)}>Cancelar</button>
                </div>
              </div>
            ) : (
              <button type="button" disabled={visible.length === 0} className="w-full rounded-lg bg-[#3b6cff] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50" onClick={() => setConfirming(true)}>Escribir a todos los fans en línea</button>
            )}
          </>
        ) : (
          <button
            type="button"
            disabled={!sendEnabled || visible.length === 0}
            className="w-full rounded-lg bg-[#3b6cff] px-3 py-1.5 text-xs font-medium text-white disabled:bg-[#eef2ff] disabled:text-[#2456c7]"
            onClick={() => { if (sendEnabled) setComposing(true); }}
          >
            {sendEnabled ? "Escribir a todos los fans en línea" : sendReason ?? "Envío a todos desactivado"}
          </button>
        )}
        {progress ? (
          <div className="space-y-1 text-[11px]">
            {progress.reason ? <p className="text-[#6d7585]">{progress.stopped && progress.retryAfter != null ? `${progress.reason} Reintento en ${progress.retryAfter} s.` : progress.reason}</p> : null}
            {progress.results.map((row) => (
              <p key={row.fanKey}>{names.get(row.fanKey) ?? row.fanKey}: {row.status}{row.reason ? ` · ${row.reason}` : ""}</p>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function priceCents(raw: string): number | null {
  const cleaned = raw.trim().replace("$", "").replace(",", ".");
  if (!cleaned) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}
