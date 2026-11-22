import { useEffect, useRef, useState } from "react";
import { queryVaultMirror } from "@/lib/of-sessions";
import { VAULT_THUMB_MISSING, vaultMediaSrc } from "@/lib/chat-media";
import { VAULT_CARD_FRAME, VAULT_CARD_IMAGE } from "@/lib/vault-card-frame";
import { folderColumnView, type FolderCover } from "@/lib/vault-folder-label";
import { folderGridCap, folderGridItems, ignoreStaleVaultView, nextVaultLibrary, sameVaultId } from "@/lib/vault-load";
import { VAULT_GRID_CLASS } from "@/lib/vault-grid";
import { vaultSentPill, vaultUsageText } from "@/lib/vault-usage";
import { VAULT_FILTER_DEBOUNCE_MS } from "@/lib/vault-debounce";

type VaultCard = {
  id: string;
  title: string;
  kind: "foto" | "video" | "audio" | "gif" | null;
  seconds: number | null;
  folder: string | null;
  listId?: string | null;
  listIds?: string[];
  tags: string[];
  salesCount: number | null;
  sentCount?: number | null;
  sent?: boolean | null;
  priceLabel?: string | null;
  posted?: boolean | null;
  hoverClip?: boolean;
  ventasLabel: string;
  bestSellerLabel: string | null;
  suggestedLabel: string;
  offerLabel?: string | null;
  buyLabel?: string | null;
  dateLabel?: string | null;
  packageLabel: string;
  packageWithId: string | null;
  sentToFan: boolean | null;
  boughtByFan: boolean | null;
  blocked: boolean;
  history: Array<{ sentAt: string | null; priceLabel: string; purchasedLabel: string; authorLabel: string }>;
};

type VaultList = {
  id: string;
  name: string;
  parentId: string | null;
  photos?: number | null;
  videos?: number | null;
  gifs?: number | null;
  audios?: number | null;
  hasMedia?: boolean | null;
  covers?: FolderCover[];
};

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

function emptyVaultCopy(notice: string | null): string {
  if (notice && notice !== "Sin datos") return notice;
  return "Sin datos";
}

export function VaultBrowser({
  creatorId,
  fanKey,
  onAttach,
  reloadToken = 0,
  layout = "full",
  onClose,
  onMore,
  onOpenFolder,
  thumbPage = { listId: "all", offset: 0 },
  pageItems = [],
  reading = false,
}: {
  creatorId: string;
  fanKey: string | null;
  onAttach?: (item: { id: string; title: string; withId?: string | null; withTitle?: string | null; seconds?: number | null; offerLabel?: string | null; dateLabel?: string | null }) => void;
  reloadToken?: number;
  layout?: "full" | "of";
  onClose?: () => void;
  onMore?: () => void;
  onOpenFolder?: (listId: string | null) => void;
  thumbPage?: { listId: string; offset: number };
  /** Medios que acaba de devolver el recorrido de esa carpeta. */
  pageItems?: ReadonlyArray<{ id: string; title: string; kind: VaultCard["kind"] }>;
  reading?: boolean;
}) {
  const [listText, setListText] = useState("");
  const [query, setQuery] = useState(EMPTY_QUERY);
  const [items, setItems] = useState<VaultCard[]>([]);
  const [library, setLibrary] = useState<VaultCard[]>([]);
  const [lists, setLists] = useState<VaultList[]>([]);
  const [notice, setNotice] = useState<string | null>("Sin datos");
  const [picked, setPicked] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  const [preview, setPreview] = useState<VaultCard | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const wantedFolder = useRef<string | null>(null);

  useEffect(() => {
    let alive = true;
    setReady(false);
    const folderId = layout === "of" && thumbPage.listId !== "all" ? thumbPage.listId : null;
    const ticket = folderId;
    void queryVaultMirror({
      data: {
        creatorId,
        fanKey,
        listText: "",
        remember: false,
        ...(layout === "of" ? { query: { ...EMPTY_QUERY, folderId, scope: folderId ? "carpeta" as const : "todas" as const } } : {}),
      },
    }).then((payload) => {
      if (!alive || ignoreStaleVaultView(wantedFolder.current, ticket)) return;
      const view = payload as VaultPayload;
      if (layout !== "of") setQuery({ ...EMPTY_QUERY, ...(view.query ?? {}) });
      applyView(view);
      setReady(true);
    }).catch(() => {
      if (!alive || ignoreStaleVaultView(wantedFolder.current, ticket)) return;
      setItems([]);
      setLists([]);
      setNotice("Sin datos");
      setReady(true);
    });
    return () => {
      alive = false;
    };
    function applyView(view: VaultPayload) {
      const incoming = view.items ?? [];
      setItems(incoming);
      setLibrary((current) => nextVaultLibrary(folderId, current, incoming));
      setLists(view.lists ?? []);
      setNotice(view.notice ?? (incoming.length > 0 ? null : "Sin datos"));
    }
  }, [creatorId, fanKey, reloadToken, layout, thumbPage.listId]);

  useEffect(() => {
    if (!ready) return;
    let alive = true;
    const handle = setTimeout(() => {
      void queryVaultMirror({ data: { creatorId, fanKey, query, listText, remember: layout !== "of" } }).then((payload) => {
        if (!alive) return;
        const view = payload as VaultPayload;
        setItems(view.items ?? []);
        setLibrary((current) => {
          if (query.scope === "carpeta" && query.folderId) return current;
          return current.length > 0 ? current : (view.items ?? []);
        });
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
  }, [ready, creatorId, fanKey, query, listText, layout]);

  const kind = query.kinds[0] ?? "";
  const openFolderId = query.scope === "carpeta" ? query.folderId : null;
  const openFolder = lists.find((folder) => sameVaultId(folder.id, openFolderId));
  const grid = folderGrid(items, pageItems, openFolderId, thumbPage.listId, folderGridCap(openFolder));
  const folderName = lists.find((folder) => sameVaultId(folder.id, query.folderId))?.name ?? "Todos los medios";
  if (layout === "of") {
    return (
      <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-white text-[#1c2333]">
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <aside className="flex w-80 shrink-0 flex-col border-r border-[#eceff3]">
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
                listId={thumbPage.listId}
                offset={thumbPage.offset}
                counts={lists.find((folder) => folder.id === "all")}
                covers={[]}
                items={library.length > 0 ? library : items}
                onClick={() => { wantedFolder.current = null; onOpenFolder?.(null); setQuery({ ...query, folderId: null, scope: "todas" }); }}
              />
              {lists.filter((folder) => folder.id !== "all").map((folder) => (
                <VaultFolder
                  key={folder.id}
                  name={folder.name}
                  creatorId={creatorId}
                  listId={folder.id}
                  offset={0}
                  counts={folder}
                  covers={folder.covers ?? []}
                  active={sameVaultId(query.folderId, folder.id)}
                  items={[]}
                  onClick={() => {
                    const id = String(folder.id);
                    wantedFolder.current = id;
                    onOpenFolder?.(id);
                    setQuery({ ...query, folderId: id, scope: "carpeta" });
                  }}
                />
              ))}
              {lists.length === 0 ? <p className="px-4 py-3 text-xs text-[#8a96a3]">Sin datos</p> : null}
            </div>
          </aside>
          <section className="flex min-h-0 min-w-0 flex-1 flex-col">
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
            <div
              className={VAULT_GRID_CLASS}
              onScroll={(event) => {
                const el = event.currentTarget;
                if (el.scrollTop + el.clientHeight >= el.scrollHeight - 160) onMore?.();
              }}
            >
              {grid.length === 0 ? <p className="col-span-4 text-sm text-[#8a96a3]">{reading ? "Cargando…" : emptyVaultCopy(notice)}</p> : null}
              {grid.map((item) => {
                const selected = picked.includes(item.id);
                const sentLabel = vaultSentPill(item.sent ?? null, item.sentCount ?? null);
                return (
                <div
                  key={item.id}
                  title={usageOf(item)}
                  className={`flex w-full flex-col bg-white text-left shadow-sm ${selected ? "ring-2 ring-[#00aff0]" : ""}`}
                  onMouseEnter={() => { if (item.kind === "video") setHoverId(item.id); }}
                  onMouseLeave={() => setHoverId((current) => current === item.id ? null : current)}
                >
                  <button
                    type="button"
                    aria-pressed={selected}
                    disabled={item.blocked || !onAttach}
                    className="block w-full disabled:opacity-50"
                    onClick={() => setPicked((current) => current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id])}
                  >
                  <span data-vault-card style={VAULT_CARD_FRAME}>
                    <VaultThumb creatorId={creatorId} itemId={item.id} title={item.title} listId={thumbPage.listId} offset={thumbPage.offset} />
                    {hoverId === item.id && item.kind === "video" && item.hoverClip ? (
                      <HoverClip src={vaultMediaSrc(creatorId, item.id, "clip", { ...thumbPage, part: "head" })} title={item.title} />
                    ) : null}
                    <span className={`absolute left-1.5 top-1.5 z-10 grid h-5 w-5 place-items-center rounded-full text-[11px] font-semibold ${selected ? "bg-[#00aff0] text-white" : "bg-white/80 text-transparent"}`}>{selected ? picked.indexOf(item.id) + 1 : ""}</span>
                  </span>
                  </button>
                  <span className="line-clamp-2 flex flex-wrap items-center gap-1 px-1 py-1">
                    {item.posted ? <span className="rounded-full bg-[#1c2333] px-1.5 py-0.5 text-[10px] text-white">Publicado</span> : null}
                    {sentLabel ? <span className="rounded-full bg-[#1c2333] px-1.5 py-0.5 text-[10px] text-white">{sentLabel}</span> : null}
                    {!item.posted && !sentLabel && priceChip(item.priceLabel) ? (
                      <span className={`rounded-full px-1.5 py-0.5 text-[10px] text-white ${priceChip(item.priceLabel) === "PPV" ? "bg-[#ff5a7a] font-semibold" : "bg-[#1c2333]"}`}>{priceChip(item.priceLabel)}</span>
                    ) : null}
                    {item.dateLabel && item.dateLabel !== "Sin datos" ? (
                      <span className="rounded-full bg-[#1c2333] px-1.5 py-0.5 text-[10px] text-white">{item.dateLabel}</span>
                    ) : null}
                    {mediaDuration(item) ? (
                      <span className="rounded bg-[#1c2333] px-1 py-0.5 text-[10px] text-white">{mediaDuration(item)}</span>
                    ) : null}
                    {item.priceLabel && item.priceLabel !== "Sin datos" && item.priceLabel !== "Free" ? (
                      <span className="rounded-full bg-[#1c2333] px-1.5 py-0.5 text-[10px] text-white">{item.priceLabel}</span>
                    ) : null}
                    <button
                      type="button"
                      aria-label={`Ver ${item.title}`}
                      className="rounded-full bg-[#1c2333] px-1.5 py-0.5 text-[10px] text-white"
                      onClick={() => setPreview(item)}
                    >Ver</button>
                  </span>
                </div>
                );
              })}
            </div>
          </section>
        </div>
        <div className="flex items-center justify-end gap-3 border-t border-[#eceff3] px-4 py-3">
          <button type="button" className="text-sm font-semibold uppercase tracking-wide text-[#8a96a3]" onClick={onClose}>Cerrar</button>
          <button
            type="button"
            disabled={picked.length === 0}
            className="rounded-full bg-[#00aff0] px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
            onClick={() => {
              for (const id of picked) {
                const item = grid.find((row) => row.id === id);
                if (!item || item.blocked) continue;
                onAttach?.({
                  id: item.id,
                  title: item.title,
                  seconds: item.seconds,
                  offerLabel: item.offerLabel ?? null,
                  dateLabel: item.dateLabel ?? null,
                });
              }
              setPicked([]);
              onClose?.();
            }}
          >
            {picked.length === 0 ? "Añadir" : `Añadir ${picked.length}`}
          </button>
        </div>
        {preview ? (
          <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-6" role="dialog" aria-label="Vista previa">
            <button type="button" className="absolute inset-0" aria-label="Cerrar vista previa" onClick={() => setPreview(null)} />
            <div data-preview-stage className="relative z-10 h-[80vh] w-[80vw]">
              {preview.kind === "video" ? (
                <VaultPlayback src={vaultMediaSrc(creatorId, preview.id, "full", thumbPage)} />
              ) : preview.kind === "audio" ? (
                <audio controls className="h-full w-full" src={vaultMediaSrc(creatorId, preview.id, "full", thumbPage)} />
              ) : (
                <img alt={preview.title} className="h-full w-full object-contain" src={vaultMediaSrc(creatorId, preview.id, "full", thumbPage)} />
              )}
            </div>
          </div>
        ) : null}
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
          {items.length === 0 ? <p className="text-xs text-[#6d7585]">{emptyVaultCopy(notice)}</p> : null}
          {items.map((item) => (
            <article key={item.id} className="rounded border border-[#e6e8ee] p-2 text-[11px]">
              {item.kind === "video" ? (
                <button type="button" className="mb-1 block w-full" aria-label={`Ver ${item.title}`} onClick={() => setPreview(item)}>
                  <VaultStill creatorId={creatorId} mediaId={item.id} className="h-24 w-full rounded object-cover" listId={thumbPage.listId} offset={thumbPage.offset} />
                </button>
              ) : (
                <VaultStill creatorId={creatorId} mediaId={item.id} className="mb-1 h-16 w-full rounded object-cover" listId={thumbPage.listId} offset={thumbPage.offset} />
              )}
              <p className="font-medium">{item.title || "Sin datos"}</p>
              <p>{mediaDuration(item) ? `${mediaDuration(item)} · ` : ""}{item.folder ?? "Sin datos"}</p>
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
        {preview ? (
          <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-6" role="dialog" aria-label="Vista previa">
            <button type="button" className="absolute inset-0" aria-label="Cerrar vista previa" onClick={() => setPreview(null)} />
            <div data-preview-stage className="relative z-10 h-[80vh] w-[80vw]">
              {preview.kind === "video" ? (
                <VaultPlayback src={vaultMediaSrc(creatorId, preview.id, "full", thumbPage)} />
              ) : preview.kind === "audio" ? (
                <audio controls className="h-full w-full" src={vaultMediaSrc(creatorId, preview.id, "full", thumbPage)} />
              ) : (
                <img alt={preview.title} className="h-full w-full object-contain" src={vaultMediaSrc(creatorId, preview.id, "full", thumbPage)} />
              )}
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function VaultThumb({ creatorId, itemId, title, listId, offset }: { creatorId: string; itemId: string; title: string; listId: string; offset: number }) {
  return <VaultStill creatorId={creatorId} mediaId={itemId} title={title} className="absolute inset-0" imageStyle={VAULT_CARD_IMAGE} listId={listId} offset={offset} />;
}

function folderGrid(
  mirror: readonly VaultCard[],
  pageItems: ReadonlyArray<{ id: string; title: string; kind: VaultCard["kind"] }>,
  folderId: string | null,
  pageListId: string,
  cap: number | null,
): VaultCard[] {
  const rows = folderGridItems(
    mirror.map((item) => ({ ...item, listId: item.listId ?? null })),
    pageItems.map((item) => ({ ...stubCard(item), listId: folderId })),
    folderId,
    pageListId,
    cap,
  );
  return rows.map((item) => mirror.find((row) => row.id === item.id) ?? item);
}

function stubCard(item: { id: string; title: string; kind: VaultCard["kind"] }): VaultCard {
  return {
    id: item.id,
    title: item.title || "Sin datos",
    kind: item.kind,
    seconds: null,
    folder: null,
    tags: [],
    salesCount: null,
    ventasLabel: "Sin datos",
    bestSellerLabel: null,
    suggestedLabel: "Sin datos",
    packageLabel: "Sin datos",
    packageWithId: null,
    sentToFan: null,
    boughtByFan: null,
    blocked: false,
    history: [],
  };
}

function usageOf(item: VaultCard): string {
  return vaultUsageText({
    posted: item.posted ?? null,
    sent: item.sent ?? null,
    sentCount: item.sentCount ?? null,
    priceLabel: item.priceLabel ?? null,
    dateLabel: item.dateLabel ?? null,
    seconds: item.seconds,
    kind: item.kind,
  });
}

function HoverClip({ src, title }: { src: string; title: string }) {
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const node = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = node.current;
    const handle = setTimeout(() => setFailed(true), 12_000);
    return () => {
      clearTimeout(handle);
      if (!video) return;
      video.pause();
      video.removeAttribute("src");
      video.load();
    };
  }, []);
  if (failed) return null;
  return (
    <video
      ref={node}
      muted
      playsInline
      autoPlay
      preload="none"
      aria-label={title}
      style={{ ...VAULT_CARD_IMAGE, opacity: ready ? 1 : 0 }}
      src={src}
      onCanPlay={() => setReady(true)}
      onError={() => setFailed(true)}
    />
  );
}

function VaultPlayback({ src }: { src: string }) {
  const node = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<"carga" | "ok" | "error">("carga");
  const [note, setNote] = useState("");
  const [openVault, setOpenVault] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const video = node.current;
    let cancelled = false;
    let hls: { destroy: () => void } | null = null;
    setState("carga");
    setNote("");
    setOpenVault(false);
    setReady(false);
    if (!src || !video) return;
    const controller = new AbortController();
    let removeFairPlay: (() => void) | null = null;
    void fetch(src, {
      signal: controller.signal,
      headers: { Range: "bytes=0-1" },
      cache: "no-store",
    }).then(async (response) => {
      const type = (response.headers.get("content-type") ?? "").toLowerCase();
      if (response.status === 409 || type.startsWith("text/plain") || type.includes("json")) {
        const hold = readPlaybackHold(await response.text());
        if (cancelled) return;
        setNote(hold.texto);
        setOpenVault(hold.abrir);
        setState("error");
        return;
      }
      if (type.includes("dash")) {
        const text = await response.text();
        if (cancelled) return;
        if (typeof window === "undefined") return;
        const dashjs = await import("dashjs");
        if (cancelled) return;
        const player = dashjs.MediaPlayer().create();
        hls = player;
        const license = widevineServer(text);
        if (license) {
          player.setProtectionData({
            "com.widevine.alpha": {
              serverURL: license,
              videoRobustness: "SW_SECURE_CRYPTO",
              audioRobustness: "SW_SECURE_CRYPTO",
            },
          });
        }
        player.updateSettings({ streaming: { buffer: { bufferTimeAtTopQuality: 12, bufferTimeAtTopQualityLongForm: 12 } } });
        let reset = false;
        player.on("error", (event: { error?: { code?: number | string; message?: string } }) => {
          const code = typeof event.error?.code === "number" ? event.error.code : null;
          reportPlaybackError(src, { tipo: "dash", detalle: event.error?.message ?? "error", fatal: true, codigo: code });
          if (!reset) {
            reset = true;
            player.reset();
          }
          if (cancelled) return;
          setNote("No se ha podido cargar el vídeo");
          setOpenVault(false);
          setState("error");
        });
        player.initialize(video, src, true);
        setReady(true);
        return;
      }
      if (type.includes("mpegurl")) {
        const text = await response.text();
        if (cancelled) return;
        if (video.canPlayType("application/vnd.apple.mpegurl")) {
          const keyUri = /#EXT-X-KEY:[^\n]*URI="([^"]+)"/.exec(text)?.[1] ?? "";
          if (keyUri.includes("variant=licencia")) removeFairPlay = hookFairPlay(video, keyUri);
          video.src = src;
          setReady(true);
          return;
        }
        // hls.js solo entra si el navegador no reproduce HLS nativo.
        const { default: Hls } = await import("hls.js");
        if (cancelled) return;
        if (!Hls.isSupported()) {
          setNote("No se ha podido cargar el vídeo");
          setState("error");
          return;
        }
        const player = new Hls({ emeEnabled: true, maxBufferLength: 10, maxMaxBufferLength: 20 });
        hls = player;
        player.loadSource(src);
        player.attachMedia(video);
        player.on(Hls.Events.MANIFEST_PARSED, () => {
          if (!cancelled) setReady(true);
        });
        player.on(Hls.Events.ERROR, (_event, data) => {
          reportPlaybackError(src, { tipo: data.type, detalle: data.details, fatal: data.fatal === true, codigo: null });
          if (!data.fatal || cancelled) return;
          setNote("No se ha podido cargar el vídeo");
          setOpenVault(false);
          setState("error");
        });
        return;
      }
      await response.body?.cancel().catch(() => undefined);
      if (cancelled) return;
      if (response.status !== 200 && response.status !== 206) {
        setNote("No se ha podido cargar el vídeo");
        setState("error");
        return;
      }
      video.src = src;
      setReady(true);
    }).catch((error: unknown) => {
      if (cancelled || (error instanceof DOMException && error.name === "AbortError")) return;
      setNote("No se ha podido cargar el vídeo");
      setState("error");
    });
    return () => {
      cancelled = true;
      controller.abort();
      removeFairPlay?.();
      hls?.destroy();
      video.pause();
      video.removeAttribute("src");
      video.load();
    };
  }, [src]);
  if (!src || state === "error") {
    return (
      <div className="flex max-w-md flex-col items-center gap-3 text-center">
        <p className="text-sm text-white">{note || "Vídeo no disponible"}</p>
        {openVault ? <a className="rounded-full bg-white px-3 py-1 text-sm text-black" href="https://onlyfans.com/my/vault" target="_blank" rel="noopener noreferrer">Abrir en OnlyFans</a> : null}
      </div>
    );
  }
  return (
    <div className="relative h-full w-full">
      {ready ? null : <p className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-sm text-white">Cargando…</p>}
      <video
        ref={node}
        data-playback={src}
        controls
        autoPlay
        playsInline
        preload="metadata"
        className="h-full w-full bg-black object-contain"
        onCanPlay={() => setState("ok")}
        onError={() => {
          reportPlaybackError(src, { tipo: "video", detalle: "media", fatal: true, codigo: node.current?.error?.code ?? null });
          setNote("No se ha podido cargar el vídeo");
          setOpenVault(false);
          setState("error");
        }}
      />
    </div>
  );
}

function widevineServer(text: string): string {
  const doc = new DOMParser().parseFromString(text, "text/xml");
  for (const node of doc.getElementsByTagName("*")) {
    if (!(node.getAttribute("schemeIdUri") ?? "").includes("edef8ba9")) continue;
    for (const child of node.getElementsByTagName("*")) {
      const name = (child.localName || child.tagName || "").toLowerCase();
      if (name !== "laurl" && !name.endsWith(":laurl")) continue;
      const value = child.textContent?.trim() ?? "";
      if (value.includes("variant=licencia")) return value;
    }
  }
  return "";
}

function hookFairPlay(video: HTMLVideoElement, licenseUrl: string): () => void {
  const onEncrypted = (event: Event) => {
    const encrypted = event as MediaEncryptedEvent;
    const initData = encrypted.initData;
    if (!initData) return;
    void (async () => {
      const access = await navigator.requestMediaKeySystemAccess("com.apple.fps.1_0", [{
        initDataTypes: [encrypted.initDataType || "sinf"],
        videoCapabilities: [{ contentType: "application/vnd.apple.mpegurl" }],
      }]);
      const keys = await access.createMediaKeys();
      await video.setMediaKeys(keys);
      const session = keys.createSession();
      session.addEventListener("message", (message) => {
        const payload = (message as MediaKeyMessageEvent).message;
        void fetch(licenseUrl, { method: "POST", body: payload }).then(async (license) => {
          await session.update(await license.arrayBuffer());
        }).catch(() => undefined);
      });
      await session.generateRequest(encrypted.initDataType || "skd", initData);
    })().catch(() => undefined);
  };
  video.addEventListener("encrypted", onEncrypted);
  return () => video.removeEventListener("encrypted", onEncrypted);
}

function reportPlaybackError(src: string, fields: { tipo: string; detalle: string; fatal: boolean; codigo: number | null }): void {
  const mediaId = (() => {
    try {
      return new URL(src, "http://127.0.0.1").searchParams.get("mediaId") ?? "";
    } catch {
      return "";
    }
  })();
  const body = { mediaId, tipo: fields.tipo, detalle: fields.detalle, fatal: fields.fatal, codigo: fields.codigo };
  void fetch("/api/vault-media?variant=debug", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => undefined);
}

function readPlaybackHold(raw: string): { texto: string; abrir: boolean } {
  const text = raw.replace(/\s+/g, " ").trim();
  try {
    const parsed = JSON.parse(text) as { texto?: unknown; abrir?: unknown };
    if (typeof parsed.texto === "string") return { texto: parsed.texto.slice(0, 160), abrir: parsed.abrir === true };
  } catch {
    return { texto: text.slice(0, 160), abrir: false };
  }
  return { texto: text.slice(0, 160), abrir: false };
}

function VaultStill({ creatorId, mediaId, className, title = "", listId, offset, imageStyle }: { creatorId: string; mediaId: string; className: string; title?: string; listId: string; offset: number; imageStyle?: typeof VAULT_CARD_IMAGE }) {
  const [missing, setMissing] = useState(false);
  if (missing) {
    return <span className={`grid place-items-center bg-[#f2f3f5] px-2 text-center text-[11px] text-[#5c6570] ${className}`}>{VAULT_THUMB_MISSING}</span>;
  }
  return (
    <img
      src={vaultMediaSrc(creatorId, mediaId, "preview", { list: listId, offset })}
      alt={title}
      className={className}
      style={imageStyle}
      onError={() => setMissing(true)}
    />
  );
}

function VaultFolder({
  name,
  active,
  items,
  covers,
  creatorId,
  listId,
  offset,
  counts,
  onClick,
}: {
  name: string;
  active: boolean;
  items: VaultCard[];
  covers: readonly FolderCover[];
  creatorId: string;
  listId: string;
  offset: number;
  counts?: { photos?: number | null; videos?: number | null; gifs?: number | null; audios?: number | null; hasMedia?: boolean | null };
  onClick: () => void;
}) {
  const column = folderColumnView({
    counts: {
      photos: counts?.photos ?? null,
      videos: counts?.videos ?? null,
      gifs: counts?.gifs ?? null,
      audios: counts?.audios ?? null,
      hasMedia: counts?.hasMedia ?? null,
    },
    covers,
    ownItems: items.map((item) => ({ id: item.id, kind: item.kind })),
  });
  return (
    <button type="button" onClick={onClick} className={`flex w-full flex-col gap-2 px-4 py-3 text-left ${active ? "bg-[#f4f7fb]" : "hover:bg-[#fafbfc]"}`}>
      <span className="min-w-0">
        <span className="line-clamp-2 block text-sm font-semibold">{name}</span>
        <span className="block text-xs text-[#8a96a3]">{column.label}</span>
      </span>
      {column.coverIds.length > 0 ? (
        <span className="flex gap-1">
          {column.coverIds.map((id) => (
            <VaultStill key={id} creatorId={creatorId} mediaId={id} className="h-12 w-12 rounded object-cover object-center" listId={listId} offset={offset} />
          ))}
        </span>
      ) : null}
    </button>
  );
}

function priceChip(label: string | null | undefined): "Gratis" | "PPV" | null {
  if (!label || label === "Sin datos") return null;
  if (label === "Free" || label === "Gratis") return "Gratis";
  return "PPV";
}

function mediaDuration(item: { kind: string | null; seconds: number | null }): string | null {
  if (item.kind !== "video" && item.kind !== "audio") return null;
  if (item.seconds == null || item.seconds <= 0) return null;
  return formatSeconds(item.seconds);
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
