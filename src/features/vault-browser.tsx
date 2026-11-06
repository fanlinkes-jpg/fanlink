import { useEffect, useMemo, useState } from "react";
import { listVault, syncVault, type VaultViewItem } from "@/lib/vault";
import {
  EMPTY_FILTERS,
  applyVaultFilters,
  attachVaultItem,
  decodeFilters,
  encodeFilters,
  filterStorageKey,
  sendToFan,
  sendsFromMessages,
  suggestPriceCents,
  type VaultFilters,
  type VaultItem,
  type VaultSend,
} from "../../server/of-sessions/sync/vault.ts";

type Folder = { id: string; name: string; parentId: string | null };
type ChatRow = {
  fromFan: boolean;
  fanKey: string | null;
  sentAt: string;
  priceCents: number | null;
  purchased: boolean | null;
  authorName: string | null;
  media: Array<{ vaultId?: string | null }> | null;
};

export function VaultBrowser({
  creatorId,
  creatorName,
  fanName,
  fanKey,
  chatterId,
  messages,
  onAttach,
}: {
  creatorId: string;
  creatorName: string;
  fanName: string | null;
  fanKey: string | null;
  chatterId: string | null;
  messages: ChatRow[];
  onAttach: (item: VaultItem, warning: string | null) => void;
}) {
  const [items, setItems] = useState<VaultItem[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [filters, setFilters] = useState<VaultFilters>(EMPTY_FILTERS);
  const [listQuery, setListQuery] = useState("");
  const sends = useMemo(() => sendsFromMessages(messages), [messages]);
  const storageKey = filterStorageKey(chatterId);

  useEffect(() => {
    if (!storageKey || typeof localStorage === "undefined") return;
    setFilters(decodeFilters(localStorage.getItem(storageKey)));
  }, [storageKey]);

  useEffect(() => {
    if (!storageKey || typeof localStorage === "undefined") return;
    localStorage.setItem(storageKey, encodeFilters(filters));
  }, [filters, storageKey]);

  useEffect(() => {
    let alive = true;
    void listVault({ data: { creatorId } }).then((view) => {
      if (!alive) return;
      setItems(view.items.map(asItem));
      setFolders(view.folders);
      setNotice(view.notice);
    }).catch(() => {
      if (alive) setNotice("Sin datos");
    });
    return () => { alive = false; };
  }, [creatorId]);

  const visibleFolders = folders.filter((folder) => folder.name.toLowerCase().includes(listQuery.trim().toLowerCase()));
  const visible = applyVaultFilters(items, folders, filters, sends, fanKey);
  const paid = sends.filter((send) => send.fanKey === fanKey && send.priceCents != null).map((send) => send.priceCents ?? 0);

  async function run(mode: "sync" | "continue") {
    const result = await syncVault({ data: { creatorId, mode } }).catch(() => ({ notice: "Sin datos" }));
    if (result.notice) setNotice(result.notice);
    const view = await listVault({ data: { creatorId } }).catch(() => null);
    if (!view) return;
    setItems(view.items.map(asItem));
    setFolders(view.folders);
    if (!result.notice) setNotice(view.notice);
  }

  return (
    <div className="flex h-full min-h-0 bg-white text-[#1c2333]">
      <aside className="flex w-56 shrink-0 flex-col border-r border-[#e6e8ee]">
        <div className="border-b border-[#e6e8ee] p-3">
          <p className="text-sm font-semibold">{fanName ? `${fanName}'s Media` : "Sin datos"}</p>
          <p className="text-xs text-[#6d7585]">{creatorName}</p>
          <input value={listQuery} onChange={(event) => setListQuery(event.target.value)} placeholder="Buscar listas" className="mt-2 w-full rounded border border-[#e6e8ee] px-2 py-1 text-xs" />
        </div>
        <div className="flex gap-1 px-3 pt-2">
          <button type="button" className="rounded border border-[#e6e8ee] px-2 py-1 text-[10px]" onClick={() => void run("sync")}>Sync now</button>
          <button type="button" className="rounded border border-[#e6e8ee] px-2 py-1 text-[10px]" onClick={() => void run("continue")}>Continue</button>
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto p-2 text-sm">
          <li><button type="button" className="w-full rounded px-2 py-1 text-left" onClick={() => setFilters({ ...filters, listId: null, folderId: null })}>Toda la bóveda</button></li>
          <li><button type="button" className="w-full rounded px-2 py-1 text-left" onClick={() => setFilters({ ...filters, listId: "feed" })}>Feed</button></li>
          <li><button type="button" className="w-full rounded px-2 py-1 text-left" onClick={() => setFilters({ ...filters, listId: "sent" })}>Sent</button></li>
          {visibleFolders.map((folder) => (
            <li key={folder.id}>
              <button type="button" className="w-full rounded px-2 py-1 text-left" style={{ paddingLeft: folder.parentId ? 16 : 8 }} onClick={() => setFilters({ ...filters, listId: folder.id, folderId: folder.id, scope: "carpeta" })}>
                {folder.name}
              </button>
            </li>
          ))}
        </ul>
      </aside>
      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap gap-2 border-b border-[#e6e8ee] p-3 text-xs">
          <input value={filters.text} onChange={(event) => setFilters({ ...filters, text: event.target.value })} placeholder="Buscar" className="rounded border border-[#e6e8ee] px-2 py-1" />
          <select aria-label="Tipo" value={filters.kind ?? ""} onChange={(event) => setFilters({ ...filters, kind: event.target.value === "foto" || event.target.value === "video" || event.target.value === "audio" ? event.target.value : null })} className="rounded border border-[#e6e8ee] px-2 py-1">
            <option value="">Tipo</option>
            <option value="foto">Foto</option>
            <option value="video">Vídeo</option>
            <option value="audio">Audio</option>
          </select>
          <select aria-label="Orden" value={filters.sort} onChange={(event) => setFilters({ ...filters, sort: event.target.value as VaultFilters["sort"] })} className="rounded border border-[#e6e8ee] px-2 py-1">
            <option value="fecha">Fecha</option>
            <option value="duracion">Duración</option>
            <option value="ventas">Ventas</option>
            <option value="precio">Precio</option>
          </select>
          <select aria-label="Alcance" value={filters.scope} onChange={(event) => setFilters({ ...filters, scope: event.target.value === "boveda" ? "boveda" : "carpeta" })} className="rounded border border-[#e6e8ee] px-2 py-1">
            <option value="carpeta">Esta carpeta</option>
            <option value="boveda">Toda la bóveda</option>
          </select>
          <select aria-label="Pareja" value={filters.couple ?? ""} onChange={(event) => setFilters({ ...filters, couple: coupleOrNull(event.target.value) })} className="rounded border border-[#e6e8ee] px-2 py-1">
            <option value="">Pareja</option>
            {["B/G", "G/G", "INDIVIDUAL", "SOLA", "PELICULA"].map((couple) => <option key={couple} value={couple}>{couple}</option>)}
          </select>
          <select aria-label="Precio" value={filters.priceKind ?? ""} onChange={(event) => setFilters({ ...filters, priceKind: event.target.value === "gratis" || event.target.value === "ppv" ? event.target.value : null })} className="rounded border border-[#e6e8ee] px-2 py-1">
            <option value="">Gratis o PPV</option>
            <option value="gratis">Gratis</option>
            <option value="ppv">PPV</option>
          </select>
          <select aria-label="Enviado" value={filters.sentToFan == null ? "" : String(filters.sentToFan)} onChange={(event) => setFilters({ ...filters, sentToFan: event.target.value === "" ? null : event.target.value === "true" })} className="rounded border border-[#e6e8ee] px-2 py-1">
            <option value="">Enviado a este fan</option>
            <option value="true">Ya enviado</option>
            <option value="false">Sin constancia</option>
          </select>
        </div>
        {notice ? <p className="px-3 py-2 text-xs text-[#6d7585]">{notice}</p> : null}
        <div className="grid min-h-0 flex-1 grid-cols-2 gap-3 overflow-y-auto p-3 md:grid-cols-3">
          {visible.length === 0 ? <p className="text-sm text-[#6d7585]">Sin datos</p> : null}
          {visible.map((item) => {
            const sent = sendToFan(sends, item.id, fanKey);
            const suggested = suggestPriceCents({ seconds: item.seconds, couple: item.couple, act: item.act, fanPaidCents: paid });
            const choice = attachVaultItem(item);
            return (
              <article key={item.id} className="overflow-hidden rounded-lg border border-[#e6e8ee]">
                {item.preview ? (
                  <img src={`/api/vault-media?creatorId=${encodeURIComponent(creatorId)}&mediaId=${encodeURIComponent(item.id)}`} alt="" className="h-28 w-full object-cover" />
                ) : (
                  <div className="grid h-28 place-items-center text-xs text-[#6d7585]">Sin datos</div>
                )}
                <div className="space-y-1 p-2 text-xs">
                  <p className="font-medium">{item.title ?? "Sin datos"}</p>
                  <p>{item.seconds == null ? "Sin datos" : formatSeconds(item.seconds)} · {priceMark(item)}</p>
                  <p className="flex gap-1">
                    {item.tags.includes("feed") ? <span className="rounded bg-[#e7f0ff] px-1">Feed</span> : null}
                    {item.tags.includes("sent") ? <span className="rounded bg-[#f3f4f6] px-1">Sent</span> : null}
                    {item.trailer ? <span className="rounded bg-[#e7f6ec] px-1">Free</span> : null}
                  </p>
                  <p>Sugerido {suggested == null ? "Sin datos" : `$${(suggested / 100).toFixed(0)}`}</p>
                  <p>{sent ? historyLine(sent) : "Sin datos"}</p>
                  {sent ? <p className="text-[#8a5a12]">Ya se le envió a este fan</p> : null}
                  <button
                    type="button"
                    disabled={!choice.ok}
                    className="rounded border border-[#e6e8ee] px-2 py-1 disabled:opacity-40"
                    onClick={() => { if (choice.ok) onAttach(item, sent ? "Ya se le envió a este fan" : null); }}
                  >
                    {choice.ok ? "Adjuntar" : choice.notice}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function asItem(item: VaultViewItem): VaultItem {
  return { ...item, preview: item.hasPreview ? "proxy" : null, full: null };
}

function coupleOrNull(value: string): VaultFilters["couple"] {
  if (value === "B/G" || value === "G/G" || value === "INDIVIDUAL" || value === "SOLA" || value === "PELICULA") return value;
  return null;
}

function priceMark(item: VaultItem): string {
  if (item.trailer || item.priceCents === 0) return "Free";
  if (item.priceCents != null && item.priceCents > 0) return `$${(item.priceCents / 100).toFixed(0)}`;
  return "Sin datos";
}

function historyLine(send: VaultSend): string {
  const when = send.sentAt.slice(0, 16).replace("T", " ");
  const price = send.priceCents == null ? "Sin datos" : `$${(send.priceCents / 100).toFixed(2)}`;
  const bought = send.purchased == null ? "Sin datos" : send.purchased ? "comprado" : "no comprado";
  return `${when} · ${price} · ${bought} · ${send.chatterName ?? "Sin datos"}`;
}

function formatSeconds(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}
