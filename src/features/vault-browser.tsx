import type { ReactNode } from "react";
import { emptyVaultQuery, filterVault, type CoupleTag, type FanVaultMarks, type VaultQuery, type VaultSort } from "../../server/of-sessions/sync/vault-filter.ts";
import type { VaultFile, VaultKind } from "../../server/of-sessions/sync/vault-model.ts";

export type VaultPick = {
  id: string;
  title: string;
  kind: VaultKind;
  seconds?: number | null;
  folder?: string | null;
  tags?: string[];
  listName?: string | null;
  description?: string | null;
  uploadedAt?: string | null;
  priceCents?: number | null;
  salesCount?: number;
  sentCount?: number;
};

const COUPLES: CoupleTag[] = ["B/G", "G/G", "SOLA", "INDIVIDUAL", "PELICULA"];

export function VaultBrowser({
  items,
  query,
  fan,
  onQuery,
  onPick,
}: {
  items: readonly VaultPick[];
  query: VaultQuery;
  fan?: FanVaultMarks;
  onQuery: (query: VaultQuery) => void;
  onPick: (item: { id: string; title: string }) => void;
}) {
  const visible = filterVault(items.map(asFile), query, fan);
  return (
    <div className="space-y-2">
      <input
        aria-label="Buscar en la bóveda"
        placeholder="Lista, carpeta, descripción o etiqueta"
        value={query.text}
        onChange={(event) => onQuery({ ...query, text: event.target.value })}
        className="h-8 w-full rounded border border-[#e6e8ee] px-2 text-sm"
      />
      <div className="flex flex-wrap gap-1">
        <Select label="Tipo" value={query.kinds[0] ?? ""} onChange={(value) => onQuery({ ...query, kinds: value === "video" || value === "foto" || value === "audio" ? [value] : [] })}>
          <option value="">Todos</option>
          <option value="video">Vídeo</option>
          <option value="foto">Foto</option>
          <option value="audio">Audio</option>
        </Select>
        <Select label="Duración" value={durationValue(query)} onChange={(value) => onQuery({ ...query, ...durationBounds(value) })}>
          <option value="">Todas</option>
          <option value="corta">Menos de 1 min</option>
          <option value="media">1–5 min</option>
          <option value="larga">5–10 min</option>
          <option value="pelicula">Más de 10 min</option>
        </Select>
        <Select label="Pareja" value={query.couples[0] ?? ""} onChange={(value) => onQuery({ ...query, couples: COUPLES.includes(value as CoupleTag) ? [value as CoupleTag] : [] })}>
          <option value="">Todas</option>
          {COUPLES.map((tag) => <option key={tag} value={tag}>{tag}</option>)}
        </Select>
        <Select label="Oferta" value={query.offer} onChange={(value) => onQuery({ ...query, offer: value === "gratis" || value === "ppv" ? value : "todas" })}>
          <option value="todas">Todas</option>
          <option value="gratis">Gratis</option>
          <option value="ppv">PPV</option>
        </Select>
        <Select label="Enviado a este fan" value={query.sent} onChange={(value) => onQuery({ ...query, sent: value === "si" || value === "no" ? value : "cualquiera" })}>
          <option value="cualquiera">Cualquiera</option>
          <option value="si">Ya enviado</option>
          <option value="no">No enviado</option>
        </Select>
        <Select label="Comprado por este fan" value={query.bought} onChange={(value) => onQuery({ ...query, bought: value === "si" || value === "no" ? value : "cualquiera" })}>
          <option value="cualquiera">Cualquiera</option>
          <option value="si">Comprado</option>
          <option value="no">No comprado</option>
        </Select>
        <Select label="Orden" value={query.sort} onChange={(value) => onQuery({ ...query, sort: sortOf(value) })}>
          <option value="fecha">Fecha</option>
          <option value="duracion">Duración</option>
          <option value="ventas">Ventas</option>
          <option value="precio">Precio</option>
        </Select>
        <label className="flex items-center gap-1 text-[11px] text-[#6d7585]">
          <input type="checkbox" checked={query.bestSeller} onChange={(event) => onQuery({ ...query, bestSeller: event.target.checked })} />
          Más vendido
        </label>
      </div>
      {visible.length === 0 ? <p className="text-xs text-[#6d7585]">Sin datos</p> : (
        <ul className="space-y-1">
          {visible.map((item) => (
            <li key={item.id}>
              <button type="button" className="w-full rounded px-2 py-1 text-left hover:bg-[#f4f7ff]" onClick={() => onPick(item)}>{item.title}</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export { emptyVaultQuery };

function Select({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <label className="text-[11px] text-[#6d7585]">{label}
      <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} className="ml-1 h-7 rounded border border-[#e6e8ee] bg-white px-1 text-xs text-[#1c2333]">
        {children}
      </select>
    </label>
  );
}

function asFile(item: VaultPick): VaultFile {
  return {
    id: item.id,
    title: item.title,
    kind: item.kind,
    seconds: item.seconds ?? null,
    preview: null,
    folder: item.folder ?? null,
    tags: item.tags ?? [],
    listId: null,
    listName: item.listName ?? null,
    description: item.description ?? null,
    uploadedAt: item.uploadedAt ?? null,
    priceCents: item.priceCents ?? null,
    salesCount: item.salesCount ?? 0,
    sentCount: item.sentCount ?? 0,
  };
}

function durationValue(query: VaultQuery): string {
  if (query.minSeconds === 0 && query.maxSeconds === 59) return "corta";
  if (query.minSeconds === 60 && query.maxSeconds === 300) return "media";
  if (query.minSeconds === 301 && query.maxSeconds === 600) return "larga";
  if (query.minSeconds === 601 && query.maxSeconds == null) return "pelicula";
  return "";
}

function durationBounds(value: string): Pick<VaultQuery, "minSeconds" | "maxSeconds"> {
  switch (value) {
    case "corta":
      return { minSeconds: 0, maxSeconds: 59 };
    case "media":
      return { minSeconds: 60, maxSeconds: 300 };
    case "larga":
      return { minSeconds: 301, maxSeconds: 600 };
    case "pelicula":
      return { minSeconds: 601, maxSeconds: null };
    default:
      return { minSeconds: null, maxSeconds: null };
  }
}

function sortOf(value: string): VaultSort {
  switch (value) {
    case "duracion":
    case "ventas":
    case "precio":
    case "fecha":
      return value;
    default:
      return "fecha";
  }
}
