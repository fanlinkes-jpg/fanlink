import type { VaultFile, VaultKind } from "./vault-model.ts";

export type CoupleTag = "B/G" | "G/G" | "SOLA" | "INDIVIDUAL" | "PELICULA";
export type VaultSort = "fecha" | "duracion" | "ventas" | "precio";
export type VaultOffer = "todas" | "gratis" | "ppv";
export type FanMark = "cualquiera" | "si" | "no";

export type VaultSearchScope = "carpeta" | "todas";

export type VaultFolder = {
  id: string;
  name: string;
  parentId: string | null;
};

export type VaultQuery = {
  text: string;
  kinds: Array<Exclude<VaultKind, null>>;
  minSeconds: number | null;
  maxSeconds: number | null;
  uploadedFrom: string | null;
  uploadedTo: string | null;
  list: string | null;
  folderId: string | null;
  scope: VaultSearchScope;
  couples: CoupleTag[];
  offer: VaultOffer;
  minPriceCents: number | null;
  maxPriceCents: number | null;
  sent: FanMark;
  bought: FanMark;
  bestSeller: boolean;
  minBuyRate: number | null;
  sort: VaultSort;
};

export type FanVaultMarks = {
  sentIds: ReadonlySet<string>;
  boughtIds: ReadonlySet<string>;
};

const COUPLES: readonly CoupleTag[] = ["B/G", "G/G", "SOLA", "INDIVIDUAL", "PELICULA"];
const KINDS: readonly Exclude<VaultKind, null>[] = ["video", "foto", "audio"];
const SORTS: readonly VaultSort[] = ["fecha", "duracion", "ventas", "precio"];

export function emptyVaultQuery(): VaultQuery {
  return {
    text: "",
    kinds: [],
    minSeconds: null,
    maxSeconds: null,
    uploadedFrom: null,
    uploadedTo: null,
    list: null,
    folderId: null,
    scope: "todas",
    couples: [],
    offer: "todas",
    minPriceCents: null,
    maxPriceCents: null,
    sent: "cualquiera",
    bought: "cualquiera",
    bestSeller: false,
    minBuyRate: null,
    sort: "fecha",
  };
}

/** Carpetas que salen de las piezas y de las listas ya guardadas. */
export function vaultFoldersFromMedia(items: readonly VaultFile[], extra: readonly VaultFolder[] = []): VaultFolder[] {
  const map = new Map<string, VaultFolder>();
  for (const folder of extra) map.set(folder.id, folder);
  for (const item of items) {
    const name = item.listName ?? item.folder;
    const id = item.listId ?? name;
    if (!id || !name || map.has(id)) continue;
    map.set(id, { id, name, parentId: null });
  }
  return [...map.values()];
}

/** La columna izquierda: el texto recorta las listas y conserva a sus padres. */
export function searchVaultLists(folders: readonly VaultFolder[], text: string): VaultFolder[] {
  const needle = fold(text.trim());
  if (!needle) return [...folders];
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const keep = new Set<string>();
  for (const folder of folders) {
    if (!fold(folder.name).includes(needle)) continue;
    keep.add(folder.id);
    let parent = folder.parentId;
    while (parent && byId.has(parent) && !keep.has(parent)) {
      keep.add(parent);
      parent = byId.get(parent)?.parentId ?? null;
    }
  }
  return folders.filter((folder) => keep.has(folder.id));
}

export function folderAndChildren(folders: readonly VaultFolder[], folderId: string): Set<string> {
  const children = new Map<string | null, string[]>();
  for (const folder of folders) {
    const list = children.get(folder.parentId) ?? [];
    list.push(folder.id);
    children.set(folder.parentId, list);
  }
  const out = new Set<string>([folderId]);
  const pending = [folderId];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) break;
    for (const child of children.get(current) ?? []) {
      if (out.has(child)) continue;
      out.add(child);
      pending.push(child);
    }
  }
  return out;
}

/**
 * Como el buscador del vault de OnlyFans: por etiqueta o por nombre de carpeta.
 * En «carpeta» no sale de la lista abierta ni de sus hijas. En «todas» recorre la bóveda.
 */
export function searchVaultMedia(
  items: readonly VaultFile[],
  folders: readonly VaultFolder[],
  input: { text: string; scope: VaultSearchScope; folderId: string | null },
): VaultFile[] {
  const open = input.scope === "carpeta" && input.folderId ? folderAndChildren(folders, input.folderId) : null;
  const needle = fold(input.text.trim());
  return items.filter((item) => {
    if (open && !itemInFolders(item, open, folders)) return false;
    if (!needle) return true;
    if (item.tags.some((tag) => fold(tag).includes(needle))) return true;
    return itemFolderNames(item, folders).some((name) => fold(name).includes(needle));
  });
}

function itemInFolders(item: VaultFile, ids: ReadonlySet<string>, folders: readonly VaultFolder[]): boolean {
  const names = new Set(folders.filter((folder) => ids.has(folder.id)).map((folder) => fold(folder.name)));
  if (item.listId && ids.has(item.listId)) return true;
  const own = [item.folder, item.listName].filter((value): value is string => Boolean(value));
  return own.some((name) => ids.has(name) || names.has(fold(name)));
}

function itemFolderNames(item: VaultFile, folders: readonly VaultFolder[]): string[] {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const names = [item.folder, item.listName].filter((value): value is string => Boolean(value));
  let current = item.listId ? byId.get(item.listId) : folders.find((folder) => names.some((name) => folder.id === name || fold(folder.name) === fold(name)));
  const seen = new Set<string>();
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    names.push(current.name);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return names;
}

export function coupleTags(item: Pick<VaultFile, "folder" | "title" | "listName" | "description" | "tags">): CoupleTag[] {
  const text = fold([item.folder, item.title, item.listName, item.description, ...item.tags].filter(Boolean).join(" "));
  const found: CoupleTag[] = [];
  if (/\bb\/g\b/.test(text)) found.push("B/G");
  if (/\bg\/g\b/.test(text)) found.push("G/G");
  if (/\bsola\b/.test(text)) found.push("SOLA");
  if (/\bindividual\b/.test(text)) found.push("INDIVIDUAL");
  if (/\bpelicula\b/.test(text)) found.push("PELICULA");
  return found;
}

/** Los filtros se suman. El texto mira lista, carpeta, descripción y etiqueta. */
export function filterVault(items: readonly VaultFile[], query: VaultQuery, fan?: FanVaultMarks): VaultFile[] {
  const needle = fold(query.text.trim());
  const listNeedle = query.list ? fold(query.list.trim()) : "";
  const matched = items.filter((item) => {
    if (needle && !textHit(item, needle)) return false;
    if (query.kinds.length > 0 && (item.kind == null || !query.kinds.includes(item.kind))) return false;
    if (!durationHit(item.seconds, query.minSeconds, query.maxSeconds)) return false;
    if (!dateHit(item.uploadedAt, query.uploadedFrom, query.uploadedTo)) return false;
    if (listNeedle && !listHit(item, listNeedle)) return false;
    if (query.couples.length > 0 && !coupleTags(item).some((tag) => query.couples.includes(tag))) return false;
    if (!offerHit(item.priceCents, query.offer)) return false;
    if (!priceHit(item.priceCents, query.minPriceCents, query.maxPriceCents)) return false;
    if (!fanHit(fan?.sentIds, item.id, query.sent)) return false;
    if (!fanHit(fan?.boughtIds, item.id, query.bought)) return false;
    if (query.minBuyRate != null && !buyRateHit(item, query.minBuyRate)) return false;
    return true;
  });
  const selling = query.bestSeller ? bestSellers(matched) : matched;
  return [...selling].sort((left, right) => compareVault(left, right, query.sort));
}

export function rememberVaultQuery(
  book: Readonly<Record<string, VaultQuery>>,
  userId: string,
  query: VaultQuery,
): Record<string, VaultQuery> {
  return { ...book, [userId]: query };
}

export function vaultQueryFor(book: Readonly<Record<string, VaultQuery>>, userId: string): VaultQuery {
  return book[userId] ?? emptyVaultQuery();
}

export function vaultQueryFromUnknown(value: unknown): VaultQuery {
  const base = emptyVaultQuery();
  const row = typeof value === "string" ? parseJson(value) : value;
  if (!row || typeof row !== "object" || Array.isArray(row)) return base;
  const record = row as Record<string, unknown>;
  return {
    text: typeof record.text === "string" ? record.text.slice(0, 120) : base.text,
    kinds: kindList(record.kinds),
    minSeconds: bound(record.minSeconds),
    maxSeconds: bound(record.maxSeconds),
    uploadedFrom: dayOf(record.uploadedFrom),
    uploadedTo: dayOf(record.uploadedTo),
    list: typeof record.list === "string" && record.list.trim() ? record.list.slice(0, 80) : null,
    folderId: typeof record.folderId === "string" && record.folderId.trim() ? record.folderId.slice(0, 80) : null,
    scope: record.scope === "carpeta" ? "carpeta" : "todas",
    couples: coupleList(record.couples),
    offer: record.offer === "gratis" || record.offer === "ppv" ? record.offer : "todas",
    minPriceCents: bound(record.minPriceCents),
    maxPriceCents: bound(record.maxPriceCents),
    sent: markOf(record.sent),
    bought: markOf(record.bought),
    bestSeller: record.bestSeller === true,
    minBuyRate: rateOf(record.minBuyRate),
    sort: SORTS.includes(record.sort as VaultSort) ? record.sort as VaultSort : "fecha",
  };
}

function bestSellers(items: readonly VaultFile[]): VaultFile[] {
  const sold = items.filter((item) => item.salesCount > 0);
  if (sold.length === 0) return [];
  const average = sold.reduce((sum, item) => sum + item.salesCount, 0) / sold.length;
  return items.filter((item) => item.salesCount > 0 && item.salesCount >= average);
}

function textHit(item: VaultFile, needle: string): boolean {
  const fields = [item.listName, item.folder, item.description, item.title, ...item.tags];
  return fields.some((field) => field != null && fold(field).includes(needle));
}

function listHit(item: VaultFile, needle: string): boolean {
  return [item.listName, item.folder].some((field) => field != null && fold(field).includes(needle));
}

function durationHit(seconds: number | null, min: number | null, max: number | null): boolean {
  if (min == null && max == null) return true;
  if (seconds == null) return false;
  if (min != null && seconds < min) return false;
  if (max != null && seconds > max) return false;
  return true;
}

function dateHit(uploadedAt: string | null, from: string | null, to: string | null): boolean {
  if (!from && !to) return true;
  const day = uploadedAt?.slice(0, 10) ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  if (from && day < from) return false;
  if (to && day > to) return false;
  return true;
}

function offerHit(cents: number | null, offer: VaultOffer): boolean {
  if (offer === "todas") return true;
  if (cents == null) return false;
  return offer === "gratis" ? cents === 0 : cents > 0;
}

function priceHit(cents: number | null, min: number | null, max: number | null): boolean {
  if (min == null && max == null) return true;
  if (cents == null) return false;
  if (min != null && cents < min) return false;
  if (max != null && cents > max) return false;
  return true;
}

function fanHit(ids: ReadonlySet<string> | undefined, itemId: string, mark: FanMark): boolean {
  if (mark === "cualquiera") return true;
  if (!ids) return false;
  const has = ids.has(itemId);
  return mark === "si" ? has : !has;
}

function buyRateHit(item: VaultFile, min: number): boolean {
  if (item.sentCount <= 0) return false;
  return item.salesCount / item.sentCount >= min;
}

function compareVault(left: VaultFile, right: VaultFile, sort: VaultSort): number {
  const delta = rank(left, sort) - rank(right, sort);
  if (delta !== 0) return -delta;
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function rank(item: VaultFile, sort: VaultSort): number {
  switch (sort) {
    case "fecha":
      return textRank(item.uploadedAt);
    case "duracion":
      return numberRank(item.seconds);
    case "ventas":
      return numberRank(item.salesCount);
    case "precio":
      return numberRank(item.priceCents);
    default: {
      const neverSort: never = sort;
      return neverSort;
    }
  }
}

function textRank(value: string | null): number {
  if (!value) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function numberRank(value: number | null): number {
  return value == null ? Number.NEGATIVE_INFINITY : value;
}

function fold(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function kindList(value: unknown): Array<Exclude<VaultKind, null>> {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is Exclude<VaultKind, null> => KINDS.includes(item as Exclude<VaultKind, null>));
}

function coupleList(value: unknown): CoupleTag[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is CoupleTag => COUPLES.includes(item as CoupleTag));
}

function bound(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return Math.round(value);
}

function dayOf(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(value)) return null;
  return value.slice(0, 10);
}

function markOf(value: unknown): FanMark {
  return value === "si" || value === "no" ? value : "cualquiera";
}

function rateOf(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) return null;
  return value;
}
