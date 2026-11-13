import { useEffect, useState } from "react";
import { queryVaultMirror } from "@/lib/of-sessions";
import { VAULT_THUMB_MISSING, vaultMediaSrc } from "@/lib/chat-media";
import { VAULT_FILTER_DEBOUNCE_MS } from "@/lib/vault-debounce";

type VaultCard = {
  id: string;
  title: string;
  kind: "foto" | "video" | "audio" | null;
  seconds: number | null;
  folder: string | null;
  tags: string[];
  salesCount: number | null;
  sentCount?: number | null;
  ventasLabel: string;
  bestSellerLabel: string | null;
  suggestedLabel: string;
  offerLabel?: string | null;
  buyLabel?: string | null;
  dateLabel?: string | null;
  posted?: boolean;
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
  onMore,
  onOpenFolder,
  thumbPage = { listId: "all", offset: 0 },
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
}) {
  const [listText, setListText] = useState("");
  const [query, setQuery] = useState(EMPTY_QUERY);
  const [items, setItems] = useState<VaultCard[]>([]);
  const [library, setLibrary] = useState<VaultCard[]>([]);
  const [lists, setLists] = useState<VaultList[]>([]);
  const [notice, setNotice] = useState<string | null>("Sin datos");
  const [picked, setPicked] = useState<string[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    setReady(false);
    void queryVaultMirror({
      data: {
        creatorId,
        fanKey,
        listText: "",
        remember: false,
        ...(layout === "of" ? { query: { ...EMPTY_QUERY } } : {}),
      },
    }).then((payload) => {
      if (!alive) return;
      const view = payload as VaultPayload;
      if (layout !== "of") setQuery({ ...EMPTY_QUERY, ...(view.query ?? {}) });
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
  }, [creatorId, fanKey, reloadToken, layout]);

  useEffect(() => {
    if (!ready) return;
    let alive = true;
    const handle = setTimeout(() => {
      void queryVaultMirror({ data: { creatorId, fanKey, query, listText, remember: layout !== "of" } }).then((payload) => {
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
  }, [ready, creatorId, fanKey, query, listText, layout]);

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
                listId={thumbPage.listId}
                offset={thumbPage.offset}
                items={library}
                onClick={() => { onOpenFolder?.(null); setQuery({ ...query, folderId: null, scope: "todas" }); }}
              />
              {lists.map((folder) => (
                <VaultFolder
                  key={folder.id}
                  name={folder.name}
                  creatorId={creatorId}
                  listId={thumbPage.listId}
                  offset={thumbPage.offset}
                  active={query.folderId === folder.id}
                  items={library.filter((item) => item.folder === folder.name || item.folder === folder.id)}
                  onClick={() => { onOpenFolder?.(folder.id); setQuery({ ...query, folderId: folder.id, scope: "carpeta" }); }}
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
            <div
              className="grid min-h-0 flex-1 grid-cols-4 content-start gap-3 overflow-y-auto px-4 pb-4"
              onScroll={(event) => {
                const el = event.currentTarget;
                if (el.scrollTop + el.clientHeight >= el.scrollHeight - 160) onMore?.();
              }}
            >
              {items.length === 0 ? <p className="col-span-4 text-sm text-[#8a96a3]">Sin datos</p> : null}
              {items.map((item) => {
                const selected = picked.includes(item.id);
                return (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={selected}
                  disabled={item.blocked || !onAttach}
                  className={`overflow-hidden rounded-xl bg-white text-left shadow-sm disabled:opacity-50 ${selected ? "ring-2 ring-[#00aff0]" : ""}`}
                  onClick={() => setPicked((current) => current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id])}
                >
                  <span className="relative block aspect-[3/4] bg-[#f2f3f5]">
                    <VaultThumb creatorId={creatorId} itemId={item.id} title={item.title} listId={thumbPage.listId} offset={thumbPage.offset} />
                    <span className={`absolute left-1.5 top-1.5 grid h-5 w-5 place-items-center rounded-full text-[11px] font-semibold ${selected ? "bg-[#00aff0] text-white" : "bg-white/80 text-transparent"}`}>{selected ? picked.indexOf(item.id) + 1 : ""}</span>
                    {item.offerLabel ? (
                      <span className="absolute right-1.5 top-1.5 rounded-full bg-[#ff5a7a] px-1.5 py-0.5 text-[10px] font-semibold text-white">{item.offerLabel}</span>
                    ) : item.posted ? (
                      <span className="absolute right-1.5 top-1.5 rounded-full bg-black/70 px-1.5 py-0.5 text-[10px] text-white">Publicado</span>
                    ) : null}
                    {item.dateLabel ? <span className="absolute bottom-1.5 left-1.5 rounded-full bg-black/70 px-1.5 py-0.5 text-[10px] text-white">{item.dateLabel}</span> : null}
                    {item.kind === "video" && item.seconds != null ? (
                      <span className="absolute bottom-1.5 right-1.5 rounded bg-black/70 px-1 py-0.5 text-[10px] text-white">{formatSeconds(item.seconds)}</span>
                    ) : null}
                  </span>
                  {item.sentCount != null || item.buyLabel || item.salesCount != null ? (
                    <span className="flex items-center gap-2 px-1.5 py-1 text-[10px] text-[#5c6570]">
                      {item.sentCount != null ? <span>{item.sentCount} envíos</span> : null}
                      {item.buyLabel ? <span>{item.buyLabel}</span> : null}
                      {item.salesCount != null ? <span>{item.salesCount} ventas</span> : null}
                    </span>
                  ) : null}
                </button>
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
                const item = items.find((row) => row.id === id);
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
                <VaultStill creatorId={creatorId} mediaId={item.id} className="mb-1 h-16 w-full rounded object-cover" listId={thumbPage.listId} offset={thumbPage.offset} />
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

function VaultThumb({ creatorId, itemId, title, listId, offset }: { creatorId: string; itemId: string; title: string; listId: string; offset: number }) {
  return <VaultStill creatorId={creatorId} mediaId={itemId} title={title} className="absolute inset-0 h-full w-full object-cover" listId={listId} offset={offset} />;
}

function VaultStill({ creatorId, mediaId, className, title = "", listId, offset }: { creatorId: string; mediaId: string; className: string; title?: string; listId: string; offset: number }) {
  const [missing, setMissing] = useState(false);
  if (missing) {
    return <span className={`grid place-items-center bg-[#f2f3f5] px-2 text-center text-[11px] text-[#5c6570] ${className}`}>{VAULT_THUMB_MISSING}</span>;
  }
  return (
    <img
      src={vaultMediaSrc(creatorId, mediaId, "preview", { list: listId, offset })}
      alt={title}
      className={className}
      onError={() => setMissing(true)}
    />
  );
}

function VaultFolder({
  name,
  active,
  items,
  creatorId,
  listId,
  offset,
  onClick,
}: {
  name: string;
  active: boolean;
  items: VaultCard[];
  creatorId: string;
  listId: string;
  offset: number;
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
      {thumb ? <VaultStill creatorId={creatorId} mediaId={thumb.id} className="h-12 w-16 rounded object-cover" listId={listId} offset={offset} /> : null}
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
