import { searchVaultLists, vaultQueryFromUnknown, type VaultQuery } from "./vault-filter.ts";
import { itemSaleBlocked } from "./vault-block.ts";
import { suggestVaultPrice, type VaultFile, type VaultKind } from "./vault-model.ts";
import type { ReadSql } from "./store.ts";
import { fanVaultUses, loadVaultMirror, loadVaultQuery, saveVaultQuery } from "./vault-store.ts";

export type VaultActor = {
  userId: string;
  role: "owner" | "member";
  perms: string[];
};

export type VaultHistoryView = {
  sentAt: string | null;
  priceLabel: string;
  purchasedLabel: string;
  authorLabel: string;
};

export type VaultCard = {
  id: string;
  title: string;
  kind: VaultKind;
  seconds: number | null;
  folder: string | null;
  tags: string[];
  salesCount: number | null;
  ventasLabel: "Ventas" | "Sin datos";
  bestSellerLabel: "Más vendido" | null;
  suggestedLabel: string;
  sentToFan: boolean | null;
  boughtByFan: boolean | null;
  blocked: boolean;
  history: VaultHistoryView[];
};

export type VaultMirrorResult = {
  chatterId: string;
  restored: boolean;
  notice: string | null;
  lists: Array<{ id: string; name: string; parentId: string | null }>;
  items: VaultCard[];
  error?: string;
};

/** Un chatter no puede pedir otro id ni quitar el filtro: siempre es el suyo. */
export function lockedChatterId(actor: { role: string; userId: string }, requested: string | null | undefined): string {
  if (actor.role !== "owner") return actor.userId;
  const trimmed = requested?.trim();
  return trimmed ? trimmed.slice(0, 80) : actor.userId;
}

export function presentGap(value: unknown): string {
  if (value == null) return "Sin datos";
  if (typeof value === "string" && !value.trim()) return "Sin datos";
  return String(value);
}

export function vaultCardHasMoney(value: unknown): boolean {
  return walk(value);
}

function walk(value: unknown): boolean {
  if (Array.isArray(value)) return value.some((item) => walk(item));
  if (!value || typeof value !== "object") {
    return typeof value === "string" && value.includes("€");
  }
  return Object.entries(value as Record<string, unknown>).some(([key, item]) => MONEY_KEY.test(key) || walk(item));
}

const MONEY_KEY = /euro|revenue|earning|profit|ingreso|totalrevenue|agency/i;

export async function queryVaultForActor(sql: ReadSql, actor: VaultActor, body: unknown): Promise<{
  status: number;
  payload: VaultMirrorResult;
}> {
  if (actor.role !== "owner" && !actor.perms.includes("vault") && !actor.perms.includes("mensajes")) {
    return { status: 403, payload: { error: "Forbidden", chatterId: actor.userId, restored: false, notice: "Sin datos", lists: [], items: [] } };
  }
  const record = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const creatorId = typeof record.creatorId === "string" ? record.creatorId : "";
  if (!creatorId) return { status: 400, payload: { error: "Sin datos", chatterId: actor.userId, restored: false, notice: "Sin datos", lists: [], items: [] } };
  const fanKey = typeof record.fanKey === "string" && record.fanKey.trim() ? record.fanKey : null;
  const chatterId = lockedChatterId(actor, typeof record.chatterId === "string" ? record.chatterId : null);
  const restored = record.query == null;
  const query = restored ? await loadVaultQuery(sql, actor.userId) : vaultQueryFromUnknown(record.query);
  if (!restored && record.remember !== false) await saveVaultQuery(sql, actor.userId, query);
  const listText = typeof record.listText === "string" ? record.listText : "";
  const mirror = await loadVaultMirror(sql, creatorId);
  const uses = fanKey ? await fanVaultUses(sql, creatorId, fanKey) : [];
  const ownUses = uses.filter((use) => use.authorId === chatterId);
  const sentIds = new Set(ownUses.map((use) => use.itemKey));
  const boughtIds = new Set(ownUses.filter((use) => use.purchased === true).map((use) => use.itemKey));
  const rows = await selectVaultItems(sql, creatorId, query, fanKey, chatterId);
  const ranked = query.bestSeller ? bestOf(rows) : rows;
  const bestIds = new Set(bestOf(rows).map((item) => item.id));
  const sorted = [...ranked].sort((left, right) => compare(left, right, query.sort));
  const purchases = purchaseCents(uses);
  const cards = sorted.map((item) => presentCard(item, mirror.folders, sentIds, boughtIds, bestIds, ownUses, purchases.get(item.id) ?? []));
  const lists = searchVaultLists(mirror.folders, listText).map((folder) => ({
    id: folder.id,
    name: folder.name,
    parentId: folder.parentId,
  }));
  return {
    status: 200,
    payload: {
      chatterId,
      restored,
      notice: cards.length === 0 ? "Sin datos" : null,
      lists,
      items: cards,
    },
  };
}

export function presentCard(
  item: VaultFile,
  folders: ReadonlyArray<{ id: string; name: string; parentId: string | null }>,
  sentIds: ReadonlySet<string>,
  boughtIds: ReadonlySet<string>,
  bestIds: ReadonlySet<string>,
  uses: ReadonlyArray<{ itemKey: string; sentAt: string | null; priceCents: number | null; purchased: boolean | null; authorId: string | null }>,
  purchases: readonly number[],
): VaultCard {
  const salesCount = item.salesCount == null ? null : item.salesCount;
  const suggested = suggestVaultPrice({
    seconds: item.seconds,
    folder: item.folder,
    title: item.title,
    purchasesCents: purchases,
  });
  return {
    id: item.id,
    title: item.title.trim() ? item.title : "Sin datos",
    kind: item.kind,
    seconds: item.seconds,
    folder: item.folder,
    tags: item.tags,
    salesCount,
    ventasLabel: salesCount == null ? "Sin datos" : "Ventas",
    bestSellerLabel: bestIds.has(item.id) ? "Más vendido" : null,
    suggestedLabel: suggested.label,
    sentToFan: sentIds.has(item.id) ? true : uses.length === 0 && sentIds.size === 0 ? null : false,
    boughtByFan: boughtIds.has(item.id) ? true : null,
    blocked: itemSaleBlocked({
      folderId: item.listId,
      folderName: item.folder ?? item.listName,
      title: item.title,
      folders,
    }),
    history: uses.filter((use) => use.itemKey === item.id).map((use) => ({
      sentAt: use.sentAt,
      priceLabel: use.priceCents == null ? "Sin datos" : `$${(use.priceCents / 100).toFixed(2)}`,
      purchasedLabel: use.purchased == null ? "Sin datos" : use.purchased ? "comprado" : "no comprado",
      authorLabel: use.authorId ?? "Sin datos",
    })),
  };
}

function purchaseCents(uses: ReadonlyArray<{ itemKey: string; priceCents: number | null; purchased: boolean | null }>): Map<string, number[]> {
  const map = new Map<string, number[]>();
  for (const use of uses) {
    if (use.purchased !== true || use.priceCents == null || use.priceCents <= 0) continue;
    const list = map.get(use.itemKey) ?? [];
    list.push(use.priceCents);
    map.set(use.itemKey, list);
  }
  return map;
}

async function selectVaultItems(sql: ReadSql, creatorId: string, query: VaultQuery, fanKey: string | null, chatterId: string): Promise<VaultFile[]> {
  const where = ["creator_id = $1", "item_key is not null"];
  const params: unknown[] = [creatorId];
  const add = (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };
  if (query.kinds.length > 0) {
    const slot = add(query.kinds);
    where.push(`kind = any(${slot}::text[])`);
  }
  if (query.minSeconds != null) where.push(`seconds is not null and seconds >= ${add(query.minSeconds)}`);
  if (query.maxSeconds != null) where.push(`seconds is not null and seconds <= ${add(query.maxSeconds)}`);
  if (query.uploadedFrom) where.push(`uploaded_at is not null and uploaded_at::date >= ${add(query.uploadedFrom)}::date`);
  if (query.uploadedTo) where.push(`uploaded_at is not null and uploaded_at::date <= ${add(query.uploadedTo)}::date`);
  const needle = fold(query.text.trim());
  if (needle) {
    where.push(`lower(coalesce(title, '') || ' ' || coalesce(folder, '') || ' ' || coalesce(list_name, '') || ' ' || coalesce(description, '') || ' ' || coalesce(tags::text, '')) like ${add(`%${escapeLike(needle)}%`)}`);
  }
  const listNeedle = query.list ? fold(query.list.trim()) : "";
  if (listNeedle) {
    where.push(`lower(coalesce(list_name, '') || ' ' || coalesce(folder, '')) like ${add(`%${escapeLike(listNeedle)}%`)}`);
  }
  if (query.couples.length > 0) {
    const parts = query.couples.map((couple) => {
      const slot = add(`%${couple.toLowerCase()}%`);
      return `lower(coalesce(title, '') || ' ' || coalesce(folder, '') || ' ' || coalesce(list_name, '') || ' ' || coalesce(description, '') || ' ' || coalesce(tags::text, '')) like ${slot}`;
    });
    where.push(`(${parts.join(" or ")})`);
  }
  if (query.offer === "gratis") where.push("price_cents = 0");
  if (query.offer === "ppv") where.push("price_cents > 0");
  if (query.minPriceCents != null) where.push(`price_cents is not null and price_cents >= ${add(query.minPriceCents)}`);
  if (query.maxPriceCents != null) where.push(`price_cents is not null and price_cents <= ${add(query.maxPriceCents)}`);
  if (query.minBuyRate != null) {
    where.push(`sent_count is not null and sent_count > 0 and sales_count is not null and sales_count::float / sent_count >= ${add(query.minBuyRate)}`);
  }
  if (query.scope === "carpeta" && query.folderId) {
    const folders = await loadVaultMirror(sql, creatorId);
    const ids = [...folderIds(folders.folders, query.folderId)];
    if (ids.length > 0) {
      const slot = add(ids);
      where.push(`(list_key = any(${slot}::text[]) or folder = any(${slot}::text[]) or list_name = any(${slot}::text[]))`);
    }
  }
  if (query.sent !== "cualquiera" || query.bought !== "cualquiera") {
    const fan = add(fanKey ?? "");
    const author = add(chatterId);
    const fanExists = (purchasedOnly: boolean) => `exists (
      select 1 from of_vault_fan_send s
      where s.creator_id = of_vault_item.creator_id
        and s.item_key = of_vault_item.item_key
        and s.fan_key = ${fan}
        and s.author_id = ${author}
        ${purchasedOnly ? "and s.purchased is true" : ""}
    )`;
    if (query.sent === "si") where.push(fanExists(false));
    if (query.sent === "no") where.push(`not ${fanExists(false)}`);
    if (query.bought === "si") where.push(fanExists(true));
    if (query.bought === "no") where.push(`not ${fanExists(true)}`);
  }
  const text = `select item_key, title, kind, seconds, preview, folder, tags, list_key, list_name, description, uploaded_at, price_cents, sales_count, sent_count
    from of_vault_item where ${where.join(" and ")}`;
  const rows = await sql.query<{
    item_key: string; title: string | null; kind: string | null; seconds: number | null; preview: string | null;
    folder: string | null; tags: unknown; list_key: string | null; list_name: string | null;
    description: string | null; uploaded_at: Date | string | null; price_cents: number | null;
    sales_count: number | null; sent_count: number | null;
  }>(text, params);
  return rows.map((row) => ({
    id: row.item_key,
    title: row.title ?? "Sin datos",
    kind: row.kind === "foto" || row.kind === "video" || row.kind === "audio" ? row.kind : null,
    seconds: row.seconds,
    preview: null,
    folder: row.folder,
    tags: tagsOf(row.tags),
    listId: row.list_key,
    listName: row.list_name,
    description: row.description,
    uploadedAt: row.uploaded_at == null ? null : row.uploaded_at instanceof Date ? row.uploaded_at.toISOString() : String(row.uploaded_at),
    priceCents: row.price_cents,
    salesCount: row.sales_count,
    sentCount: row.sent_count,
  }));
}

function folderIds(folders: ReadonlyArray<{ id: string; parentId: string | null }>, folderId: string): Set<string> {
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

function bestOf(items: readonly VaultFile[]): VaultFile[] {
  const sold = items.filter((item) => (item.salesCount ?? 0) > 0);
  if (sold.length === 0) return [];
  const average = sold.reduce((sum, item) => sum + (item.salesCount ?? 0), 0) / sold.length;
  return items.filter((item) => item.salesCount != null && item.salesCount > 0 && item.salesCount >= average);
}

function compare(left: VaultFile, right: VaultFile, sort: VaultQuery["sort"]): number {
  const delta = rank(left, sort) - rank(right, sort);
  if (delta !== 0) return -delta;
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function rank(item: VaultFile, sort: VaultQuery["sort"]): number {
  if (sort === "fecha") {
    const parsed = item.uploadedAt ? Date.parse(item.uploadedAt) : Number.NaN;
    return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
  }
  if (sort === "duracion") return item.seconds ?? Number.NEGATIVE_INFINITY;
  if (sort === "ventas") return item.salesCount ?? Number.NEGATIVE_INFINITY;
  return item.priceCents ?? Number.NEGATIVE_INFINITY;
}

function fold(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function tagsOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
    } catch {
      return [];
    }
  }
  return [];
}
