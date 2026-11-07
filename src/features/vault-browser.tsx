import { useEffect, useState } from "react";
import { queryVaultMirror } from "@/lib/of-sessions";
import { vaultMediaSrc } from "@/lib/chat-media";

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
};

export function VaultBrowser({
  creatorId,
  fanKey,
  onAttach,
}: {
  creatorId: string;
  fanKey: string | null;
  onAttach?: (item: { id: string; title: string }) => void;
}) {
  const [listText, setListText] = useState("");
  const [query, setQuery] = useState(EMPTY_QUERY);
  const [items, setItems] = useState<VaultCard[]>([]);
  const [lists, setLists] = useState<VaultList[]>([]);
  const [notice, setNotice] = useState<string | null>("Sin datos");

  useEffect(() => {
    let alive = true;
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
    return () => {
      alive = false;
    };
  }, [creatorId, fanKey, query, listText]);

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
              <img src={vaultMediaSrc(creatorId, item.id)} alt="" className="mb-1 h-16 w-full rounded object-cover" />
              <p className="font-medium">{item.title || "Sin datos"}</p>
              <p>{item.seconds == null ? "Sin datos" : formatSeconds(item.seconds)} · {item.folder ?? "Sin datos"}</p>
              <p>{item.ventasLabel}{item.salesCount == null ? "" : ` ${item.salesCount}`}{item.bestSellerLabel ? ` · ${item.bestSellerLabel}` : ""}</p>
              <p>Precio sugerido: {item.suggestedLabel}</p>
              <p>{tagLine(item.tags)}</p>
              <p>{item.sentToFan ? "Ya se le envió a este fan" : item.sentToFan == null ? "Sin datos" : "Sin constancia de envío"}</p>
              {item.history[0] ? (
                <p>{item.history[0].sentAt ?? "Sin datos"} · {item.history[0].priceLabel} · {item.history[0].purchasedLabel} · {item.history[0].authorLabel}</p>
              ) : <p>Sin datos</p>}
              <button
                type="button"
                disabled={item.blocked || !onAttach}
                className="mt-1 rounded border border-[#e6e8ee] px-2 py-1 disabled:opacity-40"
                onClick={() => onAttach?.(item)}
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
