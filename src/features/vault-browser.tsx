import { useEffect, useState } from "react";
import { queryVaultMirror } from "@/lib/of-sessions";
import { vaultMediaSrc } from "@/lib/chat-media";
import { VAULT_FILTER_DEBOUNCE_MS } from "@/lib/vault-debounce";

type VaultCard = {
  id: string;
  title: string;
  kind: "foto" | "video" | "audio" | null;
  seconds: number | null;
  folder: string | null;
  tags: string[];
  salesCount: number | null;
  ventasLabel: string;
  bestSellerLabel: string | null;
  suggestedLabel: string;
  packageLabel: string;
  packageWithId: string | null;
  sentToFan: boolean | null;
  boughtByFan: boolean | null;
  blocked: boolean;
  history: Array<{ sentAt: string | null; priceLabel: string; purchasedLabel: string; authorLabel: string }>;
};

type VaultList = { id: string; name: string; parentId: string | null };

type VaultPayload = {
  chatterId?: string;
  notice?: string | null;
  lists?: VaultList[];
  items?: VaultCard[];
  query?: typeof EMPTY_QUERY;
  error?: string;
};

const EMPTY_QUERY = {
  text: "",
  kinds: [] as string[],
  minSeconds: null as number | null,
  maxSeconds: null as number | null,
  uploadedFrom: null as string | null,
  uploadedTo: null as string | null,
  list: null as string | null,
  folderId: null as string | null,
  scope: "todas" as "todas" | "carpeta",
  couples: [] as string[],
  offer: "todas" as "todas" | "gratis" | "ppv",
  minPriceCents: null as number | null,
  maxPriceCents: null as number | null,
  sent: "cualquiera" as "cualquiera" | "si" | "no",
  bought: "cualquiera" as "cualquiera" | "si" | "no",
  bestSeller: false,
  minBuyRate: null as number | null,
  sort: "fecha" as "fecha" | "duracion" | "ventas" | "precio",
  themes: [] as string[],
};

export function VaultBrowser({
  creatorId,
  fanKey,
  onAttach,
  reloadToken = 0,
  layout = "full",
  onClose,
}: {
  creatorId: string;
  fanKey: string | null;
  onAttach?: (item: { id: string; title: string; withId?: string | null; withTitle?: string | null }) => void;
  reloadToken?: number;
  layout?: "full" | "of";
  onClose?: () => void;
}) {
  const [listText, setListText] = useState("");
  const [query, setQuery] = useState(EMPTY_QUERY);
  const [items, setItems] = useState<VaultCard[]>([]);
  const [library, setLibrary] = useState<VaultCard[]>([]);
  const [lists, setLists] = useState<VaultList[]>([]);
  const [notice, setNotice] = useState<string | null>("Sin datos");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    setReady(false);
    void queryVaultMirror({ data: { creatorId, fanKey, listText: "", remember: false } }).then((payload) => {
      if (!alive) return;
      const view = payload as VaultPayload;
      setQuery({ ...EMPTY_QUERY, ...(view.query ?? {}) });
      applyView(view);
      setReady(true);
    }).catch(() => {
      if (!alive) return;
      setItems([]);
      setLists([]);
      setNotice("Sin datos");
      setReady(true);
    });
    return () => {
      alive = false;
    };
    function applyView(view: VaultPayload) {
      setItems(view.items ?? []);
      setLibrary(view.items ?? []);
      setLists(view.lists ?? []);
      setNotice(view.notice ?? (view.items && view.items.length > 0 ? null : "Sin datos"));
    }
  }, [creatorId, fanKey, reloadToken]);

  useEffect(() => {
    if (!ready) return;
    let alive = true;
    const handle = setTimeout(() => {
      void queryVaultMirror({ data: { creatorId, fanKey, query, listText, remember: true } }).then((payload) => {
        if (!alive) return;
        const view = payload as VaultPayload;
        setItems(view.items ?? []);
        setLists(view.lists ?? []);
        setNotice(view.notice ?? (view.items && view.items.length > 0 ? null : "Sin datos"));
      }).catch(() => {
        if (!alive) return;
        setItems([]);
        setLists([]);
        setNotice("Sin datos");
      });
    }, VAULT_FILTER_DEBOUNCE_MS);
    return () => {
      alive = false;
      clearTimeout(handle);
    };
  }, [ready, creatorId, fanKey, query, listText]);

  const kind = query.kinds[0] ?? "";
  const folderName = lists.find((folder) => folder.id === query.folderId)?.name ?? "Todos los medios";
  if (layout === "of") {
    return (
      <div className="flex h-full min-h-0 flex-col bg-white text-[#1c2333]">
        <div className="flex min-h-0 flex-1">
          <aside className="flex w-72 shrink-0 flex-col border-r border-[#eceff3]">
            <div className="flex items-center gap-2 border-b border-[#eceff3] px-4 py-3">
              <p className="text-sm font-semibold tracking-wide">BÓVEDA</p>
              <input aria-label="Buscar listas" value={listText} placeholder="Buscar" onChange={(event) => setListText(event.target.value)} className="ml-auto h-8 w-28 rounded-full border border-[#e6e8ee] px-3 text-xs" />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <p className="px-4 pb-1 pt-3 text-[11px] font-semibold tracking-wide text-[#8a96a3]">DEFAULT</p>
              <VaultFolder
                name="Todos los medios"
                active={query.scope !== "carpeta"}
                creatorId={creatorId}
                items={library}
                onClick={() => setQuery({ ...query, folderId: null, scope: "todas" })}
              />
              {lists.map((folder) => (
                <VaultFolder
                  key={folder.id}
                  name={folder.name}
                  creatorId={creatorId}
                  active={query.folderId === folder.id}
                  items={library.filter((item) => item.folder === folder.name || item.folder === folder.id)}
                  onClick={() => setQuery({ ...query, folderId: folder.id, scope: "carpeta" })}
                />
              ))}
              {lists.length === 0 ? <p className="px-4 py-3 text-xs text-[#8a96a3]">Sin datos</p> : null}
            </div>
          </aside>
          <section className="flex min-w-0 flex-1 flex-col">
            <div className="border-b border-[#eceff3] px-4 py-3">
              <p className="text-sm font-semibold uppercase tracking-wide">{folderName}</p>
            </div>
            <p className="px-4 pb-1 pt-3 text-[11px] font-semibold tracking-wide text-[#8a96a3]">RECIENTE</p>
            <div className="flex flex-wrap gap-2 px-4 py-3">
              {[
                ["", "Todo"],
                ["foto", "Foto"],
                ["gif", "GIF"],
                ["video", "Vídeo"],
                ["audio", "Audio"],
              ].map(([id, label]) => (
                <button
                  key={label}
                  type="button"
                  className={`rounded-full px-4 py-1.5 text-sm ${kind === id ? "bg-[#d7ebff] font-medium text-[#0091ea]" : "bg-[#f2f3f5] text-[#1c2333]"}`}
                  onClick={() => setQuery({ ...query, kinds: id ? [id] : [] })}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="grid min-h-0 flex-1 grid-cols-3 content-start gap-2 overflow-y-auto px-4 pb-4">
              {items.length === 0 ? <p className="col-span-3 text-sm text-[#8a96a3]">Sin datos</p> : null}
              {items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  disabled={item.blocked || !onAttach}
                  className="relative aspect-[4/3] overflow-hidden rounded-md bg-[#f2f3f5] text-left disabled:opacity-50"
                  onClick={() => {
                    const other = items.find((row) => row.id === item.packageWithId);
                    onAttach?.({ id: item.id, title: item.title, withId: item.packageWithId, withTitle: other?.title ?? null });
                  }}
                >
                  <span className="absolute inset-x-1 bottom-6 truncate text-[10px] text-[#1c2333]">{item.title || "Sin datos"}</span>
                  <img src={vaultMediaSrc(creatorId, item.id, "preview")} alt={item.title || ""} className="absolute inset-0 h-full w-full object-cover" onError={(event) => { event.currentTarget.hidden = true; }} />
                  {item.kind === "video" && item.seconds != null ? (
                    <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1 text-[11px] text-white">{formatSeconds(item.seconds)}</span>
                  ) : null}
                  <span className="absolute right-1.5 top-1.5 h-5 w-5 rounded-full border-2 border-white bg-black/20" />
                  {item.blocked ? <span className="absolute bottom-1 right-1 rounded bg-white/90 px-1 text-[10px]">NO VENDER</span> : null}
                </button>
              ))}
            </div>
          </section>
        </div>
        <div className="flex justify-end border-t border-[#eceff3] px-4 py-3">
          <button type="button" className="text-sm font-semibold uppercase tracking-wide text-[#00aff0]" onClick={onClose}>Cerrar</button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-64 gap-3">
      <aside className="flex w-40 shrink-0 flex-col gap-2">
        <input aria-label="Buscar listas" value={listText} placeholder="Buscar listas" onChange={(event) => setListText(event.target.value)} className="rounded border border-[#e6e8ee] px-2 py-1 text-xs" />
        <button type="button" className="rounded px-2 py-1 text-left text-xs" onClick={() => setQuery({ ...query, folderId: null, scope: "todas" })}>Toda la bóveda</button>
        <ul className="max-h-52 space-y-1 overflow-y-auto text-xs">
          {lists.length === 0 ? <li className="text-[#6d7585]">Sin datos</li> : null}
          {lists.map((folder) => (
            <li key={folder.id}>
              <button type="button" className="w-full rounded px-2 py-1 text-left hover:bg-[#f4f7ff]" style={{ paddingLeft: folder.parentId ? 12 : 4 }} onClick={() => setQuery({ ...query, folderId: folder.id, scope: "carpeta" })}>
                {folder.name}
              </button>
            </li>
          ))}
        </ul>
      </aside>
      <section className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap gap-1 text-[11px]">
          <input aria-label="Buscar en la bóveda" value={query.text} placeholder="Etiqueta o carpeta" onChange={(event) => setQuery({ ...query, text: event.target.value })} className="rounded border border-[#e6e8ee] px-2 py-1" />
          <input aria-label="Temática" value={query.themes[0] ?? ""} placeholder="Temática" onChange={(event) => setQuery({ ...query, themes: event.target.value.trim() ? [event.target.value] : [] })} className="w-24 rounded border border-[#e6e8ee] px-2 py-1" />
          <select aria-label="Tipo" value={query.kinds[0] ?? ""} onChange={(event) => setQuery({ ...query, kinds: event.target.value ? [event.target.value] : [] })} className="rounded border border-[#e6e8ee] px-1 py-1">
            <option value="">Tipo</option>
            <option value="video">Vídeo</option>
            <option value="foto">Foto</option>
            <option value="audio">Audio</option>
          </select>
          <select aria-label="Duración" value={durationValue(query.minSeconds, query.maxSeconds)} onChange={(event) => setQuery({ ...query, ...durationQuery(event.target.value) })} className="rounded border border-[#e6e8ee] px-1 py-1">
            <option value="">Duración</option>
            <option value="0-30">Hasta 30 s</option>
            <option value="30-120">30 s – 2 min</option>
            <option value="120-">Más de 2 min</option>
          </select>
          <input aria-label="Subido desde" type="date" value={query.uploadedFrom ?? ""} onChange={(event) => setQuery({ ...query, uploadedFrom: event.target.value || null })} className="rounded border border-[#e6e8ee] px-1 py-1" />
          <input aria-label="Subido hasta" type="date" value={query.uploadedTo ?? ""} onChange={(event) => setQuery({ ...query, uploadedTo: event.target.value || null })} className="rounded border border-[#e6e8ee] px-1 py-1" />
          <input aria-label="Precio mínimo" inputMode="decimal" placeholder="Precio mín" value={dollarsField(query.minPriceCents)} onChange={(event) => setQuery({ ...query, minPriceCents: centsField(event.target.value) })} className="w-20 rounded border border-[#e6e8ee] px-1 py-1" />
          <input aria-label="Precio máximo" inputMode="decimal" placeholder="Precio máx" value={dollarsField(query.maxPriceCents)} onChange={(event) => setQuery({ ...query, maxPriceCents: centsField(event.target.value) })} className="w-20 rounded border border-[#e6e8ee] px-1 py-1" />
          <input aria-label="Buy rate" inputMode="decimal" placeholder="Buy rate" value={query.minBuyRate == null ? "" : String(query.minBuyRate)} onChange={(event) => setQuery({ ...query, minBuyRate: numberOrNull(event.target.value) })} className="w-20 rounded border border-[#e6e8ee] px-1 py-1" />
          <select aria-label="Orden" value={query.sort} onChange={(event) => setQuery({ ...query, sort: event.target.value as typeof query.sort })} className="rounded border border-[#e6e8ee] px-1 py-1">
            <option value="fecha">Fecha</option>
            <option value="duracion">Duración</option>
            <option value="ventas">Ventas</option>
            <option value="precio">Precio</option>
          </select>
          <select aria-label="Pareja" value={query.couples[0] ?? ""} onChange={(event) => setQuery({ ...query, couples: event.target.value ? [event.target.value] : [] })} className="rounded border border-[#e6e8ee] px-1 py-1">
            <option value="">Pareja</option>
            {["B/G", "G/G", "SOLA", "INDIVIDUAL", "PELICULA"].map((tag) => <option key={tag} value={tag}>{tag}</option>)}
          </select>
          <select aria-label="Gratis o PPV" value={query.offer} onChange={(event) => setQuery({ ...query, offer: event.target.value as typeof query.offer })} className="rounded border border-[#e6e8ee] px-1 py-1">
            <option value="todas">Gratis o PPV</option>
            <option value="gratis">Gratis</option>
            <option value="ppv">PPV</option>
          </select>
          <select aria-label="Enviado a este fan" value={query.sent} onChange={(event) => setQuery({ ...query, sent: event.target.value as typeof query.sent })} className="rounded border border-[#e6e8ee] px-1 py-1">
            <option value="cualquiera">Enviado</option>
            <option value="si">Ya enviado</option>
            <option value="no">No enviado</option>
          </select>
          <select aria-label="Comprado por este fan" value={query.bought} onChange={(event) => setQuery({ ...query, bought: event.target.value as typeof query.bought })} className="rounded border border-[#e6e8ee] px-1 py-1">
            <option value="cualquiera">Comprado</option>
            <option value="si">Comprado</option>
            <option value="no">No comprado</option>
          </select>
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={query.bestSeller} onChange={(event) => setQuery({ ...query, bestSeller: event.target.checked })} />
            Más vendido
          </label>
        </div>
        {notice ? <p className="text-xs text-[#6d7585]">{notice}</p> : null}
        <div className="grid max-h-64 grid-cols-2 gap-2 overflow-y-auto md:grid-cols-3">
          {items.length === 0 ? <p className="text-xs text-[#6d7585]">Sin datos</p> : null}
          {items.map((item) => (
            <article key={item.id} className="rounded border border-[#e6e8ee] p-2 text-[11px]">
              {item.kind === "video" ? (
                <video controls preload="none" src={vaultMediaSrc(creatorId, item.id, "full")} className="mb-1 h-24 w-full rounded bg-black" />
              ) : (
                <img src={vaultMediaSrc(creatorId, item.id, "preview")} alt="" className="mb-1 h-16 w-full rounded object-cover" />
              )}
              <p className="font-medium">{item.title || "Sin datos"}</p>
              <p>{item.seconds == null ? "Sin datos" : formatSeconds(item.seconds)} · {item.folder ?? "Sin datos"}</p>
              <p>{item.ventasLabel}{item.salesCount == null ? "" : ` ${item.salesCount}`}{item.bestSellerLabel ? ` · ${item.bestSellerLabel}` : ""}</p>
              <p>Precio sugerido: {item.suggestedLabel}</p>
              <p>{item.packageLabel || "Sin datos"}</p>
              <p>{tagLine(item.tags)}</p>
              <p>{item.sentToFan ? "Ya se le envió a este fan" : item.sentToFan == null ? "Sin datos" : "Sin constancia de envío"}</p>
              {item.history.length > 0 ? item.history.map((row, index) => (
                <p key={`${row.authorLabel}-${row.sentAt ?? index}`}>{row.sentAt ?? "Sin datos"} · {row.priceLabel} · {row.purchasedLabel} · {row.authorLabel}</p>
              )) : <p>Sin datos</p>}
              <button
                type="button"
                disabled={item.blocked || !onAttach}
                className="mt-1 rounded border border-[#e6e8ee] px-2 py-1 disabled:opacity-40"
                onClick={() => {
                  const other = items.find((row) => row.id === item.packageWithId);
                  onAttach?.({ id: item.id, title: item.title, withId: item.packageWithId, withTitle: other?.title ?? null });
                }}
              >
                {item.blocked ? "NO VENDER" : "Adjuntar"}
              </button>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function VaultFolder({
  name,
  active,
  items,
  creatorId,
  onClick,
}: {
  name: string;
  active: boolean;
  items: VaultCard[];
  creatorId: string;
  onClick: () => void;
}) {
  const photos = items.filter((item) => item.kind === "foto").length;
  const videos = items.filter((item) => item.kind === "video").length;
  const thumb = items.find((item) => item.kind !== "audio");
  return (
    <button type="button" onClick={onClick} className={`flex w-full items-center gap-3 px-4 py-3 text-left ${active ? "bg-[#f4f7fb]" : "hover:bg-[#fafbfc]"}`}>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{name}</span>
        <span className="text-xs text-[#8a96a3]">{items.length === 0 ? "vacío" : `${photos} fotos · ${videos} vídeos`}</span>
      </span>
      {thumb ? <img src={vaultMediaSrc(creatorId, thumb.id, "preview")} alt="" className="h-12 w-16 rounded object-cover" /> : null}
    </button>
  );
}

function formatSeconds(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

function numberOrNull(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function centsField(value: string): number | null {
  const dollars = numberOrNull(value);
  return dollars == null ? null : Math.round(dollars * 100);
}

function dollarsField(cents: number | null): string {
  return cents == null ? "" : String(cents / 100);
}

function durationValue(minSeconds: number | null, maxSeconds: number | null): string {
  if (minSeconds === 0 && maxSeconds === 30) return "0-30";
  if (minSeconds === 30 && maxSeconds === 120) return "30-120";
  if (minSeconds === 120 && maxSeconds == null) return "120-";
  return "";
}

function durationQuery(value: string): { minSeconds: number | null; maxSeconds: number | null } {
  if (value === "0-30") return { minSeconds: 0, maxSeconds: 30 };
  if (value === "30-120") return { minSeconds: 30, maxSeconds: 120 };
  if (value === "120-") return { minSeconds: 120, maxSeconds: null };
  return { minSeconds: null, maxSeconds: null };
}

function tagLine(tags: readonly string[]): string {
  const shown = ["Feed", "Sent", "Tráiler"].filter((tag) => tags.includes(tag));
  return shown.length > 0 ? shown.join(" ") : "Sin datos";
}
