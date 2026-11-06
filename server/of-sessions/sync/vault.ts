export const VAULT_PACE_MS = 5_000;

export type VaultKind = "foto" | "video" | "audio" | null;
export type VaultCouple = "B/G" | "G/G" | "INDIVIDUAL" | "SOLA" | "PELICULA";
export type VaultTag = "sent" | "feed";
export type VaultBlock = "NO VENDER" | "SIN EDITAR";

export type VaultFolder = {
  id: string;
  name: string;
  parentId: string | null;
};

export type VaultItem = {
  id: string;
  title: string | null;
  kind: VaultKind;
  seconds: number | null;
  preview: string | null;
  full: string | null;
  createdAt: string | null;
  folderId: string | null;
  tags: VaultTag[];
  priceCents: number | null;
  sales: number | null;
  trailer: boolean;
  couple: VaultCouple | null;
  act: string | null;
  blocked: VaultBlock | null;
};

export type VaultRead = {
  items: VaultItem[];
  folders: VaultFolder[];
  cursor: string | null;
  done: boolean;
  notice: string | null;
};

export type VaultSend = {
  mediaId: string;
  fanKey: string;
  sentAt: string;
  priceCents: number | null;
  purchased: boolean | null;
  chatterName: string | null;
};

export type VaultFilters = {
  text: string;
  kind: VaultKind;
  minSeconds: number | null;
  maxSeconds: number | null;
  from: string | null;
  to: string | null;
  folderId: string | null;
  couple: VaultCouple | null;
  priceKind: "gratis" | "ppv" | null;
  minPrice: number | null;
  maxPrice: number | null;
  sentToFan: boolean | null;
  purchased: boolean | null;
  bestSeller: boolean;
  sort: "fecha" | "duracion" | "ventas" | "precio";
  scope: "carpeta" | "boveda";
  listId: string | null;
};

export const EMPTY_FILTERS: VaultFilters = {
  text: "",
  kind: null,
  minSeconds: null,
  maxSeconds: null,
  from: null,
  to: null,
  folderId: null,
  couple: null,
  priceKind: null,
  minPrice: null,
  maxPrice: null,
  sentToFan: null,
  purchased: null,
  bestSeller: false,
  sort: "fecha",
  scope: "carpeta",
  listId: null,
};

/** Solo se abre la página del vault. La API la pide esa página, no nosotros. */
export function vaultPageUrl(origin: string): string {
  return `${origin.replace(/\/$/, "")}/my/vault`;
}

export function plannedVaultNavigation(origin: string): string[] {
  return [vaultPageUrl(origin)];
}

export function vaultPaceMs(raw: string | undefined): number {
  if (raw == null || raw.trim() === "") return VAULT_PACE_MS;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < VAULT_PACE_MS) return VAULT_PACE_MS;
  return Math.min(value, 60_000);
}

export function continueVault(hasCursor: boolean, mode: "sync" | "continue"): { go: boolean; notice: string | null } {
  if (mode === "sync") return { go: true, notice: null };
  if (!hasCursor) return { go: false, notice: "Sin datos" };
  return { go: true, notice: null };
}

export function coupleFromName(name: string | null): VaultCouple | null {
  if (!name) return null;
  const text = name.normalize("NFD").replace(/\p{M}/gu, "").toUpperCase();
  if (text.includes("B/G")) return "B/G";
  if (text.includes("G/G")) return "G/G";
  if (text.includes("INDIVIDUAL")) return "INDIVIDUAL";
  if (text.includes("PELICULA")) return "PELICULA";
  if (text.includes("SOLA")) return "SOLA";
  return null;
}

function normalizeLabel(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

/** "No-vender", "no vender" y "SIN-EDITAR" cuentan igual. */
export function sendBlock(...parts: Array<string | null>): VaultBlock | null {
  const text = normalizeLabel(parts.filter((part): part is string => Boolean(part)).join(" "));
  if (!text) return null;
  if (/(^| )NO VENDER( |$)/.test(text)) return "NO VENDER";
  if (/(^| )SIN EDITAR( |$)/.test(text)) return "SIN EDITAR";
  return null;
}

/** Una subcarpeta hereda el bloqueo de cualquiera de sus padres. Si falta un padre, la cadena queda bloqueada. */
export function inheritedBlock(folders: VaultFolder[], folderId: string | null): VaultBlock | null {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const seen = new Set<string>();
  let current = folderId;
  while (current && !seen.has(current)) {
    seen.add(current);
    const folder = byId.get(current);
    if (!folder) return "NO VENDER";
    const block = sendBlock(folder.name);
    if (block) return block;
    current = folder.parentId;
  }
  return null;
}

/** Regla de agencia, no un precio leído de OnlyFans. Se puede sustituir. */
export type PriceRule = {
  soloMin: number;
  soloMax: number;
  soloPerMinute: number;
  coupleMin: number;
  coupleMax: number;
  couplePerMinute: number;
  step: number;
};

export const DEFAULT_PRICE_RULE: PriceRule = {
  soloMin: 1200,
  soloMax: 1700,
  soloPerMinute: 108,
  coupleMin: 1900,
  coupleMax: 2900,
  couplePerMinute: 160,
  step: 100,
};

export const PRICE_RULE_LABEL = "Regla";

export type FanPurchase = { priceCents: number | null; purchased: boolean | null };

export function priceRuleFromEnv(raw: string | undefined): PriceRule {
  if (raw == null || raw.trim() === "") return { ...DEFAULT_PRICE_RULE };
  try {
    const parsed = JSON.parse(raw) as Partial<PriceRule>;
    const rule = { ...DEFAULT_PRICE_RULE, ...parsed };
    const values = [rule.soloMin, rule.soloMax, rule.soloPerMinute, rule.coupleMin, rule.coupleMax, rule.couplePerMinute, rule.step];
    if (values.some((value) => !Number.isInteger(value) || value < 0)) return { ...DEFAULT_PRICE_RULE };
    if (rule.soloMin > rule.soloMax || rule.coupleMin > rule.coupleMax) return { ...DEFAULT_PRICE_RULE };
    return rule;
  } catch {
    return { ...DEFAULT_PRICE_RULE };
  }
}

/**
 * Sola, unos $1.08 por minuto, entre $12 y $17.
 * Pareja, entre $19 y $29. Anal o película, el techo.
 * El escalón solo sube desde compras reales (purchased), no desde un envío con precio.
 */
export function suggestPriceCents(input: {
  seconds: number | null;
  couple: VaultCouple | null;
  act: string | null;
  purchases?: FanPurchase[];
  rule?: PriceRule;
}): number | null {
  if (input.seconds == null || input.seconds < 0 || input.couple == null) return null;
  const rule = input.rule ?? DEFAULT_PRICE_RULE;
  const couple = input.couple === "B/G" || input.couple === "G/G";
  const min = couple ? rule.coupleMin : rule.soloMin;
  const max = couple ? rule.coupleMax : rule.soloMax;
  const perMinute = couple ? rule.couplePerMinute : rule.soloPerMinute;
  const high = input.couple === "PELICULA" || (input.act ?? "").toLowerCase().includes("anal");
  let price = Math.min(max, Math.max(min, Math.round((input.seconds / 60) * perMinute)));
  if (high) price = max;
  const bought = (input.purchases ?? []).filter((row) => row.purchased === true && row.priceCents != null && row.priceCents >= 0);
  if (!high && bought.length > 0) {
    const last = bought[bought.length - 1]?.priceCents ?? min;
    price = Math.min(max, Math.max(min, last + rule.step));
  }
  return price;
}

export function parseVaultPayload(payload: unknown): VaultRead {
  const row = record(payload);
  const folders = foldersFrom(row);
  const folderNames = new Map(folders.map((folder) => [folder.id, folder.name]));
  const items = itemsFrom(row, folderNames, folders);
  const hasMore = row?.hasMore === true || row?.has_more === true;
  const cursor = text(row?.nextOffset ?? row?.next_offset ?? row?.offset);
  return {
    items,
    folders,
    cursor: hasMore ? cursor : null,
    done: row?.hasMore === false || row?.has_more === false,
    notice: null,
  };
}

export function sendsFromMessages(messages: Array<{
  fromFan: boolean;
  fanKey: string | null;
  sentAt: string;
  priceCents: number | null;
  purchased: boolean | null;
  authorName: string | null;
  media?: Array<{ vaultId?: string | null }> | null;
}>): VaultSend[] {
  const sends: VaultSend[] = [];
  for (const message of messages) {
    if (message.fromFan || !message.fanKey) continue;
    for (const media of message.media ?? []) {
      if (!media.vaultId) continue;
      sends.push({
        mediaId: media.vaultId,
        fanKey: message.fanKey,
        sentAt: message.sentAt,
        priceCents: message.priceCents,
        purchased: message.purchased,
        chatterName: message.authorName,
      });
    }
  }
  return sends;
}

export function sendToFan(sends: VaultSend[], mediaId: string, fanKey: string | null): VaultSend | null {
  if (!fanKey) return null;
  return sends.find((send) => send.mediaId === mediaId && send.fanKey === fanKey) ?? null;
}

export function attachVaultItem(item: VaultItem): { ok: true; warning: string | null } | { ok: false; notice: string } {
  if (item.blocked) return { ok: false, notice: item.blocked };
  return { ok: true, warning: null };
}

export function applyVaultFilters(
  items: VaultItem[],
  folders: VaultFolder[],
  filters: VaultFilters,
  sends: VaultSend[],
  fanKey: string | null,
): VaultItem[] {
  const tree = filters.scope === "boveda" || !filters.folderId ? null : folderTree(folders, filters.folderId);
  const priced = items.map((item) => item.sales).filter((value): value is number => value != null);
  const topSales = priced.length ? Math.max(...priced) : null;
  const filtered = items.filter((item) => {
    if (filters.listId === "sent" || filters.listId === "feed") {
      if (!item.tags.includes(filters.listId)) return false;
    } else if (filters.listId && item.folderId !== filters.listId) return false;
    if (tree && (item.folderId == null || !tree.has(item.folderId))) return false;
    if (filters.kind && item.kind !== filters.kind) return false;
    if (filters.minSeconds != null && (item.seconds == null || item.seconds < filters.minSeconds)) return false;
    if (filters.maxSeconds != null && (item.seconds == null || item.seconds > filters.maxSeconds)) return false;
    if (filters.from && (!item.createdAt || item.createdAt < filters.from)) return false;
    if (filters.to && (!item.createdAt || item.createdAt > filters.to)) return false;
    if (filters.couple && item.couple !== filters.couple) return false;
    if (filters.priceKind === "gratis" && !item.trailer && item.priceCents !== 0) return false;
    if (filters.priceKind === "ppv" && (item.trailer || item.priceCents == null || item.priceCents <= 0)) return false;
    if (filters.minPrice != null && (item.priceCents == null || item.priceCents < filters.minPrice)) return false;
    if (filters.maxPrice != null && (item.priceCents == null || item.priceCents > filters.maxPrice)) return false;
    const sent = sendToFan(sends, item.id, fanKey);
    if (filters.sentToFan === true && !sent) return false;
    if (filters.sentToFan === false && sent) return false;
    if (filters.purchased === true && sent?.purchased !== true) return false;
    if (filters.purchased === false && sent?.purchased !== false) return false;
    if (filters.bestSeller && (topSales == null || item.sales !== topSales)) return false;
    if (filters.text.trim()) {
      const haystack = [item.title, item.act, item.folderId, ...item.tags].filter(Boolean).join(" ").toLowerCase();
      const folder = folders.find((entry) => entry.id === item.folderId);
      const blob = `${haystack} ${folder?.name ?? ""}`.toLowerCase();
      if (!blob.includes(filters.text.trim().toLowerCase())) return false;
    }
    return true;
  });
  const sorted = [...filtered].sort((left, right) => compareVault(left, right, filters.sort));
  return sorted;
}

export function folderTree(folders: VaultFolder[], rootId: string): Set<string> {
  const children = new Map<string | null, string[]>();
  for (const folder of folders) {
    const list = children.get(folder.parentId) ?? [];
    list.push(folder.id);
    children.set(folder.parentId, list);
  }
  const out = new Set<string>([rootId]);
  const pending = [rootId];
  while (pending.length) {
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

export function filterStorageKey(chatterId: string | null): string | null {
  if (!chatterId || !/^[a-zA-Z0-9_-]{1,80}$/.test(chatterId)) return null;
  return `fanlink-vault-filters:${chatterId}`;
}

export function encodeFilters(filters: VaultFilters): string {
  return JSON.stringify(filters);
}

export function decodeFilters(raw: string | null): VaultFilters {
  if (!raw) return { ...EMPTY_FILTERS };
  try {
    const parsed = JSON.parse(raw) as Partial<VaultFilters>;
    return { ...EMPTY_FILTERS, ...parsed, text: typeof parsed.text === "string" ? parsed.text : "" };
  } catch {
    return { ...EMPTY_FILTERS };
  }
}

export function vaultForBrowser(item: VaultItem): Omit<VaultItem, "preview" | "full"> & { hasPreview: boolean } {
  const { preview, full, ...rest } = item;
  void full;
  return { ...rest, hasPreview: Boolean(preview) };
}

/** Ventas y precio por pieza son ingresos. Un chatter no los recibe. */
export function vaultForRole<T extends { sales: number | null; priceCents: number | null }>(item: T, canSeeRevenue: boolean): T {
  if (canSeeRevenue) return item;
  return { ...item, sales: null, priceCents: null };
}

export type VaultPageLike = {
  goto(url: string): Promise<void>;
  on(event: "response", handler: (response: { url(): string; status(): number; text(): Promise<string> }) => void): void;
  off(event: "response", handler: (response: { url(): string; status(): number; text(): Promise<string> }) => void): void;
  scroll(): Promise<void>;
};

/** Escucha el JSON que pide la página. No construye ni firma una llamada a api2. */
export async function captureVault(
  page: VaultPageLike,
  origin: string,
  mode: "sync" | "continue",
  options: { paceMs?: number; hasCursor?: boolean; wait?: (ms: number) => Promise<void> } = {},
): Promise<VaultRead> {
  const decision = continueVault(options.hasCursor === true, mode);
  if (!decision.go) return { items: [], folders: [], cursor: null, done: false, notice: decision.notice };
  const found: VaultRead[] = [];
  const pending: Promise<void>[] = [];
  const onResponse = (response: { url(): string; status(): number; text(): Promise<string> }) => {
    if (response.status() < 200 || response.status() >= 300) return;
    if (!/vault/i.test(response.url())) return;
    pending.push(response.text().then((raw) => {
      try {
        found.push(parseVaultPayload(JSON.parse(raw) as unknown));
      } catch {
        // HTML u otra cosa que no es el listado.
      }
    }).catch(() => undefined));
  };
  page.on("response", onResponse);
  try {
    const target = vaultPageUrl(origin);
    if (target.includes("/api2/") || target.includes("/api/")) {
      return { items: [], folders: [], cursor: null, done: false, notice: "Sin datos" };
    }
    await page.goto(target);
    if (mode === "continue") await page.scroll();
    await (options.wait ?? delay)(options.paceMs ?? VAULT_PACE_MS);
    await Promise.all(pending);
  } finally {
    page.off("response", onResponse);
  }
  return mergeReads(found);
}

function mergeReads(parts: VaultRead[]): VaultRead {
  const items = new Map<string, VaultItem>();
  const folders = new Map<string, VaultFolder>();
  let cursor: string | null = null;
  let done = false;
  for (const part of parts) {
    for (const folder of part.folders) folders.set(folder.id, folder);
    for (const item of part.items) items.set(item.id, item);
    if (part.cursor) cursor = part.cursor;
    done = done || part.done;
  }
  return { items: [...items.values()], folders: [...folders.values()], cursor, done, notice: null };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function compareVault(left: VaultItem, right: VaultItem, sort: VaultFilters["sort"]): number {
  if (sort === "duracion") return (left.seconds ?? -1) - (right.seconds ?? -1);
  if (sort === "ventas") return (left.sales ?? -1) - (right.sales ?? -1);
  if (sort === "precio") return (left.priceCents ?? -1) - (right.priceCents ?? -1);
  return (left.createdAt ?? "").localeCompare(right.createdAt ?? "");
}

function itemsFrom(row: Record<string, unknown> | null, folderNames: Map<string, string>, folders: VaultFolder[]): VaultItem[] {
  const list = arrayOf(row, ["list", "items", "media", "files"]);
  const items: VaultItem[] = [];
  for (const entry of list) {
    const item = record(entry);
    if (!item || item.type === "folder" || item.isFolder === true) continue;
    const id = text(item.id ?? item.mediaId);
    if (!id) continue;
    const folderId = text(item.listId ?? item.folderId ?? record(item.vaultList)?.id);
    const folderName = folderId ? folderNames.get(folderId) ?? text(record(item.vaultList)?.name) : null;
    const tags = tagsFrom(item);
    const title = text(item.title ?? item.name ?? item.fileName);
    const blocked = sendBlock(title, folderName) ?? inheritedBlock(folders, folderId);
    items.push({
      id,
      title,
      kind: kindOf(item.type ?? item.mediaType),
      seconds: secondsOf(item.duration ?? item.durationSeconds),
      preview: urlOf(item.thumb ?? item.preview ?? record(item.files)?.thumb ?? record(record(item.files)?.thumb)?.url),
      full: urlOf(record(item.files)?.full ?? record(record(item.files)?.full)?.url ?? item.src),
      createdAt: iso(item.createdAt ?? item.created_at),
      folderId,
      tags,
      priceCents: centsOf(item.price),
      sales: countOf(item.purchasedCount ?? item.sales ?? record(item.counters)?.purchased),
      trailer: item.isFree === true || item.free === true || item.isPreview === true,
      couple: coupleFromName(folderName),
      act: text(item.act ?? item.label),
      blocked,
    });
  }
  return items;
}

function foldersFrom(row: Record<string, unknown> | null): VaultFolder[] {
  const list = arrayOf(row, ["folders", "lists", "vaultLists"]);
  const folders: VaultFolder[] = [];
  for (const entry of list) {
    const item = record(entry);
    if (!item) continue;
    const id = text(item.id);
    const name = text(item.name ?? item.title);
    if (!id || !name) continue;
    if (item.type != null && item.type !== "folder" && item.type !== "list" && item.type !== "custom") continue;
    folders.push({ id, name, parentId: text(item.parentId ?? item.parent_id) });
  }
  return folders;
}

function tagsFrom(item: Record<string, unknown>): VaultTag[] {
  const tags = new Set<VaultTag>();
  for (const entry of arrayOf(item, ["listStates", "lists", "labels"])) {
    const row = record(entry);
    const label = (text(row?.type ?? row?.name ?? entry) ?? "").toLowerCase();
    if (label === "sent" || label === "messages") tags.add("sent");
    if (label === "feed" || label === "posts") tags.add("feed");
  }
  return [...tags];
}

function kindOf(value: unknown): VaultKind {
  const textValue = (text(value) ?? "").toLowerCase();
  if (textValue.includes("video")) return "video";
  if (textValue.includes("audio")) return "audio";
  if (textValue.includes("photo") || textValue.includes("image") || textValue.includes("foto")) return "foto";
  return null;
}

function arrayOf(row: Record<string, unknown> | null, keys: string[]): unknown[] {
  if (!row) return [];
  for (const key of keys) {
    if (Array.isArray(row[key])) return row[key] as unknown[];
  }
  return [];
}

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function text(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(Math.trunc(value));
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 200) : null;
}

function secondsOf(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return Math.round(value);
}

function centsOf(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return Math.round(value * 100);
  return null;
}

function countOf(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) return null;
  return value;
}

function urlOf(value: unknown): string | null {
  const nested = record(value);
  const raw = nested ? text(nested.url) : text(value);
  if (!raw || !/^https?:\/\//.test(raw)) return null;
  return raw;
}

function iso(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}
