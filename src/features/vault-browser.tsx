import { useState, type ReactNode } from "react";
import { emptyVaultQuery, filterVault, searchVaultLists, searchVaultMedia, vaultFoldersFromMedia, type CoupleTag, type FanVaultMarks, type VaultFolder, type VaultQuery, type VaultSearchScope, type VaultSort } from "../../server/of-sessions/sync/vault-filter.ts";
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
  folders = [],
  query,
  fan,
  onQuery,
  onPick,
}: {
  items: readonly VaultPick[];
  folders?: readonly VaultFolder[];
  query: VaultQuery;
  fan?: FanVaultMarks;
  onQuery: (query: VaultQuery) => void;
  onPick: (item: { id: string; title: string }) => void;
}) {
  const [listQuery, setListQuery] = useState("");
  const files = items.map(asFile);
  const tree = vaultFoldersFromMedia(files, folders);
  const lists = searchVaultLists(tree, listQuery);
  const filtered = filterVault(files, { ...query, text: "" }, fan);
  const visible = searchVaultMedia(filtered, tree, { text: query.text, scope: query.scope, folderId: query.folderId });
  return (
    <div className="flex h-full min-h-72 overflow-hidden bg-white text-[#1c2333]">
      <aside className="flex w-52 shrink-0 flex-col border-r border-[#e6e8ee] bg-[#f6f7f8]" aria-label="Listas de la bóveda">
        <div className="p-2">
          <input
            aria-label="Buscar listas"
            placeholder="Search"
            value={listQuery}
            onChange={(event) => setListQuery(event.target.value)}
            className="h-8 w-full rounded-full border border-[#e6e8ee] bg-white px-3 text-sm"
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto pb-2">
          <ListButton
            pressed={query.folderId == null}
            depth={0}
            onClick={() => onQuery({ ...query, folderId: null, scope: "todas" })}
          >
            All media
          </ListButton>
          <FolderBranch
            folders={lists}
            parentId={null}
            depth={0}
            selected={query.folderId}
            onSelect={(folderId) => onQuery({ ...query, folderId, scope: "carpeta" })}
          />
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-[#e6e8ee] p-2">
          <input
            aria-label="Buscar por etiqueta o carpeta"
            placeholder="Search tags or lists"
            value={query.text}
            onChange={(event) => onQuery({ ...query, text: event.target.value })}
            className="h-8 min-w-0 flex-1 rounded-full border border-[#e6e8ee] px-3 text-sm"
          />
          <ScopeButton current={query.scope} value="carpeta" disabled={query.folderId == null} onQuery={onQuery} query={query}>En esta lista</ScopeButton>
          <ScopeButton current={query.scope} value="todas" onQuery={onQuery} query={query}>En todas</ScopeButton>
        </div>
        <div className="flex flex-wrap gap-1 border-b border-[#e6e8ee] px-2 py-1">
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
        {visible.length === 0 ? <p className="p-3 text-xs text-[#6d7585]">Sin datos</p> : (
          <ul className="grid min-h-0 flex-1 grid-cols-3 gap-1 overflow-y-auto p-2">
            {visible.map((item) => (
              <li key={item.id}>
                <button type="button" className="flex aspect-square w-full flex-col justify-end rounded-md bg-[#eceef2] p-1 text-left text-[10px] hover:ring-2 hover:ring-[#00aff0]" onClick={() => onPick(item)}>
                  <span className="truncate font-medium">{item.title}</span>
                  <span className="text-[#6d7585]">{item.listName ?? item.folder ?? "All media"}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export { emptyVaultQuery };

function FolderBranch({
  folders,
  parentId,
  depth,
  selected,
  onSelect,
}: {
  folders: readonly VaultFolder[];
  parentId: string | null;
  depth: number;
  selected: string | null;
  onSelect: (folderId: string) => void;
}) {
  return folders.filter((folder) => folder.parentId === parentId).map((folder) => (
    <div key={folder.id}>
      <ListButton pressed={selected === folder.id} depth={depth} onClick={() => onSelect(folder.id)}>{folder.name}</ListButton>
      <FolderBranch folders={folders} parentId={folder.id} depth={depth + 1} selected={selected} onSelect={onSelect} />
    </div>
  ));
}

function ListButton({
  pressed,
  depth,
  onClick,
  children,
}: {
  pressed: boolean;
  depth: number;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={`block w-full truncate py-1.5 pr-2 text-left text-sm ${pressed ? "bg-[#e7f6fd] font-medium text-[#0091c7]" : "hover:bg-[#eceef2]"}`}
      style={{ paddingLeft: 12 + depth * 14 }}
    >
      {children}
    </button>
  );
}

function ScopeButton({
  current,
  value,
  disabled = false,
  query,
  onQuery,
  children,
}: {
  current: VaultSearchScope;
  value: VaultSearchScope;
  disabled?: boolean;
  query: VaultQuery;
  onQuery: (query: VaultQuery) => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={current === value}
      disabled={disabled}
      onClick={() => onQuery({ ...query, scope: value })}
      className={`shrink-0 rounded-full px-2 py-1 text-[11px] ${current === value ? "bg-[#00aff0] text-white" : "bg-[#f3f4f6] text-[#1c2333]"} disabled:opacity-40`}
    >
      {children}
    </button>
  );
}

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
