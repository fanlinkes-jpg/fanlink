import type { ReadSql } from "./store.ts";
import { emptyVaultQuery, vaultQueryFromUnknown, type VaultQuery } from "./vault-filter.ts";
import { historyFromMedia, historyFromSends, mergeFanUses, parseVaultBundle, type FanVaultUse, type VaultFile, type VaultList } from "./vault-model.ts";
import type { SaleFolder } from "./vault-block.ts";
import { itemSaleBlocked } from "./vault-block.ts";
import { planVaultPieces, type VaultSendPiece } from "../send/vault-piece.ts";

export async function saveVaultMirror(sql: ReadSql, creatorId: string, items: readonly VaultFile[], lists: readonly VaultList[], now = new Date()): Promise<void> {
  const syncedAt = now.toISOString();
  const parentColumn = await hasColumn(sql, "of_vault_list", "parent_key");
  for (const list of lists) {
    if (parentColumn) {
      await sql.query(
        `insert into of_vault_list (creator_id, list_key, name, parent_key, synced_at)
         values ($1, $2, $3, $4, $5)
         on conflict (creator_id, list_key) do update set name = excluded.name, synced_at = excluded.synced_at`,
        [creatorId, list.id, list.name, null, syncedAt],
      );
    } else {
      await sql.query(
        `insert into of_vault_list (creator_id, list_key, name, synced_at)
         values ($1, $2, $3, $4)
         on conflict (creator_id, list_key) do update set name = excluded.name, synced_at = excluded.synced_at`,
        [creatorId, list.id, list.name, syncedAt],
      );
    }
  }
  const legacyMedia = await primaryKeyUses(sql, "of_vault_item", "media_id");
  for (const item of items) {
    const tags = JSON.stringify(item.tags);
    if (legacyMedia) {
      await sql.query(
        `insert into of_vault_item (
           creator_id, media_id, item_key, title, kind, seconds, preview, folder, tags, list_key, list_name,
           description, uploaded_at, price_cents, sales_count, sent_count, synced_at
         ) values ($1, $2, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
         on conflict (creator_id, media_id) do update set
           item_key = excluded.item_key, title = excluded.title, kind = excluded.kind, seconds = excluded.seconds,
           preview = excluded.preview, folder = excluded.folder, tags = excluded.tags, list_key = excluded.list_key,
           list_name = excluded.list_name, description = excluded.description, uploaded_at = excluded.uploaded_at,
           price_cents = excluded.price_cents, sales_count = excluded.sales_count, sent_count = excluded.sent_count,
           synced_at = excluded.synced_at`,
        rowValues(creatorId, item, tags, syncedAt),
      );
    } else {
      await sql.query(
        `insert into of_vault_item (
           creator_id, item_key, title, kind, seconds, preview, folder, tags, list_key, list_name,
           description, uploaded_at, price_cents, sales_count, sent_count, synced_at
         ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
         on conflict (creator_id, item_key) do update set
           title = excluded.title, kind = excluded.kind, seconds = excluded.seconds, preview = excluded.preview,
           folder = excluded.folder, tags = excluded.tags, list_key = excluded.list_key, list_name = excluded.list_name,
           description = excluded.description, uploaded_at = excluded.uploaded_at, price_cents = excluded.price_cents,
           sales_count = excluded.sales_count, sent_count = excluded.sent_count, synced_at = excluded.synced_at`,
        rowValues(creatorId, item, tags, syncedAt),
      );
    }
  }
  await sql.query(
    `insert into of_vault_sync (creator_id, synced_at) values ($1, $2)
     on conflict (creator_id) do update set synced_at = excluded.synced_at`,
    [creatorId, syncedAt],
  );
  if (await hasColumn(sql, "of_vault_item", "full_url")) {
    for (const item of items) {
      if (!item.fullUrl) continue;
      await sql.query(
        "update of_vault_item set full_url = $3 where creator_id = $1 and item_key = $2",
        [creatorId, item.id, item.fullUrl],
      );
    }
  }
  if (await hasColumn(sql, "of_vault_item", "paid_with_id")) {
    for (const item of items) {
      await sql.query(
        "update of_vault_item set paid_with_id = $3 where creator_id = $1 and item_key = $2",
        [creatorId, item.id, item.paidWithId ?? null],
      );
    }
  }
}

/** Lo que la página de OnlyFans ya pidió al abrir la bóveda entra en el espejo. */
export async function persistVaultRead(
  sql: ReadSql,
  creatorId: string,
  payloads: readonly unknown[],
  page?: { listId?: string; offset?: number },
): Promise<VaultFile[]> {
  const items = new Map<string, VaultFile>();
  const lists = new Map<string, VaultList>();
  for (const payload of payloads) {
    const bundle = parseVaultBundle(payload);
    for (const list of bundle.lists) lists.set(list.id, list);
    for (const item of bundle.items) items.set(item.id, item);
  }
  const saved = [...items.values()];
  if (saved.length === 0 && lists.size === 0) return [];
  await saveVaultMirror(sql, creatorId, saved, [...lists.values()]);
  if (saved.length > 0 && page) await rememberThumbPage(sql, creatorId, saved.map((item) => item.id), page);
  return saved;
}

export async function saveVaultPreview(
  sql: ReadSql,
  creatorId: string,
  mediaId: string,
  preview: string,
  page?: { listId: string; offset: number },
): Promise<void> {
  await sql.query(
    "update of_vault_item set preview = $3 where creator_id = $1 and item_key = $2",
    [creatorId, mediaId, preview],
  );
  if (page) await rememberThumbPage(sql, creatorId, [mediaId], page);
}

/** Lista y offset de `vault/media` con los que se leyó el medio. Null si la columna aún no está. */
export async function storedVaultPage(sql: ReadSql, creatorId: string, mediaId: string): Promise<{ listId: string; offset: number } | null> {
  if (!(await hasColumn(sql, "of_vault_item", "thumb_offset"))) return null;
  const rows = await sql.query<{ thumb_list: string | null; thumb_offset: number | null }>(
    "select thumb_list, thumb_offset from of_vault_item where creator_id = $1 and item_key = $2",
    [creatorId, mediaId],
  );
  const row = rows[0];
  if (!row) return null;
  return { listId: row.thumb_list?.trim() || "all", offset: pageOffset(row.thumb_offset ?? 0) };
}

async function rememberThumbPage(sql: ReadSql, creatorId: string, ids: readonly string[], page: { listId?: string; offset?: number }): Promise<void> {
  if (!(await hasColumn(sql, "of_vault_item", "thumb_offset"))) return;
  const list = page.listId?.trim().slice(0, 80) || "all";
  const offset = pageOffset(page.offset ?? 0);
  for (const id of ids) {
    await sql.query(
      "update of_vault_item set thumb_list = $3, thumb_offset = $4 where creator_id = $1 and item_key = $2",
      [creatorId, id, list, offset],
    );
  }
}

function pageOffset(offset: number): number {
  if (!Number.isFinite(offset) || offset <= 0) return 0;
  return Math.min(2_000, Math.floor(offset));
}

export async function loadVaultMirror(sql: ReadSql, creatorId: string): Promise<{ items: VaultFile[]; lists: VaultList[]; folders: SaleFolder[]; syncedAt: string | null }> {
  const lists = await sql.query<{ list_key: string; name: string; parent_key?: string | null }>(
    "select list_key, name, parent_key from of_vault_list where creator_id = $1 order by name",
    [creatorId],
  );
  const items = await sql.query<{
    item_key: string; title: string | null; kind: string | null; seconds: number | null; preview: string | null;
    folder: string | null; tags: unknown; list_key: string | null; list_name: string | null;
    description: string | null; uploaded_at: Date | string | null; price_cents: number | null;
    sales_count: number | null; sent_count: number | null; paid_with_id?: string | null;
  }>(
    `select item_key, title, kind, seconds, preview, folder, tags, list_key, list_name,
            description, uploaded_at, price_cents, sales_count, sent_count
            ${await hasColumn(sql, "of_vault_item", "paid_with_id") ? ", paid_with_id" : ""}
     from of_vault_item where creator_id = $1 and item_key is not null order by title`,
    [creatorId],
  );
  const sync = await sql.query<{ synced_at: Date | string | null }>(
    "select synced_at from of_vault_sync where creator_id = $1",
    [creatorId],
  );
  return {
    lists: lists.map((row) => ({ id: row.list_key, name: row.name })),
    folders: lists.map((row) => ({ id: row.list_key, name: row.name, parentId: row.parent_key ?? null })),
    items: items.map((row) => ({
      id: row.item_key,
      title: row.title ?? "Sin datos",
      kind: row.kind === "foto" || row.kind === "video" || row.kind === "audio" ? row.kind : null,
      seconds: row.seconds,
      preview: row.preview,
      folder: row.folder,
      tags: tagsOf(row.tags),
      listId: row.list_key,
      listName: row.list_name,
      description: row.description,
      uploadedAt: iso(row.uploaded_at),
      priceCents: row.price_cents,
      salesCount: row.sales_count,
      sentCount: row.sent_count,
      paidWithId: row.paid_with_id ?? null,
    })),
    syncedAt: sync[0]?.synced_at == null ? null : sync[0].synced_at instanceof Date ? sync[0].synced_at.toISOString() : String(sync[0].synced_at),
  };
}

export async function loadSaleContext(sql: ReadSql, creatorId: string, itemIds: readonly string[]): Promise<{
  sales: Array<{
    folderId: string | null;
    folderName: string | null;
    title: string | null;
    folders: SaleFolder[];
  }>;
  missing: string[];
}> {
  if (itemIds.length === 0) return { sales: [], missing: [] };
  const mirror = await loadVaultMirror(sql, creatorId);
  const byId = new Map(mirror.items.map((item) => [item.id, item]));
  const missing = itemIds.filter((id) => !byId.has(id));
  const sales = itemIds.filter((id) => byId.has(id)).map((id) => {
    const item = byId.get(id);
    return {
      folderId: item?.listId ?? null,
      folderName: item?.folder ?? item?.listName ?? null,
      title: item?.title ?? null,
      folders: mirror.folders,
    };
  });
  return { sales, missing };
}

export async function prepareVaultSend(sql: ReadSql, creatorId: string, itemIds: readonly string[]): Promise<
  { ok: true; pieces: VaultSendPiece[]; sales: Awaited<ReturnType<typeof loadSaleContext>>["sales"] }
  | { ok: false; reason: "NO VENDER" | "Sin datos" }
> {
  if (itemIds.length === 0) return { ok: true, pieces: [], sales: [] };
  const loaded = await loadSaleContext(sql, creatorId, itemIds);
  if (loaded.missing.length > 0 || loaded.sales.some((sale) => itemSaleBlocked(sale))) {
    return { ok: false, reason: "NO VENDER" };
  }
  const rows = await sql.query<{
    item_key: string;
    title: string | null;
    folder: string | null;
    list_name: string | null;
    list_key: string | null;
  }>(
    "select item_key, title, folder, list_name, list_key from of_vault_item where creator_id = $1 and item_key is not null",
    [creatorId],
  );
  const planned = planVaultPieces(rows.map((row) => ({
    id: row.item_key,
    title: row.title,
    folder: row.folder,
    listName: row.list_name,
    listId: row.list_key,
  })), itemIds);
  if (!planned.ok) return planned;
  return { ok: true, pieces: planned.pieces, sales: loaded.sales };
}

export async function piecePurchaseCents(sql: ReadSql, creatorId: string): Promise<Map<string, number[]>> {
  const rows = await sql.query<{ item_key: string; price_cents: number | null }>(
    `select item_key, price_cents from of_vault_fan_send
     where creator_id = $1 and purchased is true and price_cents is not null and price_cents > 0`,
    [creatorId],
  );
  const map = new Map<string, number[]>();
  for (const row of rows) {
    if (row.price_cents == null || row.price_cents <= 0) continue;
    const list = map.get(row.item_key) ?? [];
    list.push(row.price_cents);
    map.set(row.item_key, list);
  }
  return map;
}

export async function recordOutboundMedia(sql: ReadSql, outboundId: string, creatorId: string, mediaIds: readonly string[]): Promise<void> {
  let position = 0;
  for (const mediaId of mediaIds) {
    await sql.query(
      `insert into of_outbound_media (outbound_id, creator_id, media_id, position)
       values ($1, $2, $3, $4)
       on conflict (outbound_id, media_id) do nothing`,
      [outboundId, creatorId, mediaId, position],
    );
    position += 1;
  }
}

export async function listOutboundMediaIds(sql: ReadSql, outboundId: string): Promise<string[]> {
  const rows = await sql.query<{ media_id: string | null }>(
    "select media_id from of_outbound_media where outbound_id = $1 order by position, media_id",
    [outboundId],
  );
  return rows.flatMap((row) => row.media_id ? [row.media_id] : []);
}

export async function fanVaultUses(sql: ReadSql, creatorId: string, fanKey: string): Promise<FanVaultUse[]> {
  const sends = await sql.query<{
    fan_key: string; item_key: string; sent_at: Date | string | null; price_cents: number | null;
    purchased: boolean | null; author_id: string | null;
  }>(
    `select fan_key, item_key, sent_at, price_cents, purchased, author_id
     from of_vault_fan_send where creator_id = $1 and fan_key = $2`,
    [creatorId, fanKey],
  );
  let fromThread: FanVaultUse[] = [];
  if (await hasColumn(sql, "of_chat_message", "media_json")) {
    const messages = await sql.query<{
      fan_key: string | null; from_fan: boolean; sent_at: Date | string | null; price_cents: number | null;
      purchased: boolean | null; author_id: string | null; media_json: string | null;
    }>(
      `select fan_key, from_fan, sent_at, price_cents, purchased, author_id, media_json
       from of_chat_message where creator_id = $1 and fan_key = $2`,
      [creatorId, fanKey],
    );
    fromThread = historyFromMedia(messages.map((row) => ({
      fanKey: row.fan_key,
      fromFan: row.from_fan === true,
      sentAt: iso(row.sent_at),
      priceCents: row.price_cents,
      purchased: row.purchased,
      authorId: row.author_id,
      mediaJson: row.media_json,
    })));
  }
  return mergeFanUses([
    ...fromThread,
    ...historyFromSends(sends.map((row) => ({
      fanKey: row.fan_key,
      itemKey: row.item_key,
      sentAt: iso(row.sent_at),
      priceCents: row.price_cents,
      purchased: row.purchased,
      authorId: row.author_id,
    }))),
  ]);
}

export async function noteVaultFanSend(sql: ReadSql, input: {
  id: string;
  creatorId: string;
  fanKey: string;
  itemKey: string;
  sentAt: string;
  priceCents: number | null;
  authorId: string | null;
}): Promise<void> {
  await sql.query(
    `insert into of_vault_fan_send (id, creator_id, fan_key, item_key, sent_at, price_cents, purchased, author_id)
     values ($1, $2, $3, $4, $5, $6, null, $7)`,
    [input.id, input.creatorId, input.fanKey, input.itemKey, input.sentAt, input.priceCents, input.authorId],
  );
}

export async function saveVaultQuery(sql: ReadSql, userId: string, query: VaultQuery): Promise<void> {
  await sql.query(
    `insert into of_vault_filter (user_id, query, updated_at) values ($1, $2::jsonb, now())
     on conflict (user_id) do update set query = excluded.query, updated_at = now()`,
    [userId, JSON.stringify(query)],
  );
}

export async function loadVaultQuery(sql: ReadSql, userId: string): Promise<VaultQuery> {
  const rows = await sql.query<{ query: unknown }>(
    "select query from of_vault_filter where user_id = $1",
    [userId],
  );
  return rows[0] ? vaultQueryFromUnknown(rows[0].query) : emptyVaultQuery();
}

async function primaryKeyUses(sql: ReadSql, table: string, column: string): Promise<boolean> {
  const rows = await sql.query<{ column_name: string }>(
    `select a.attname as column_name
     from pg_index i
     join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
     where i.indrelid = ($1)::regclass and i.indisprimary`,
    [table],
  );
  return rows.some((row) => row.column_name === column);
}

async function hasColumn(sql: ReadSql, table: string, column: string): Promise<boolean> {
  const rows = await sql.query<{ n: number | string }>(
    `select count(*)::int as n from information_schema.columns
     where table_schema = 'public' and table_name = $1 and column_name = $2`,
    [table, column],
  );
  return Number(rows[0]?.n ?? 0) > 0;
}

function rowValues(creatorId: string, item: VaultFile, tags: string, syncedAt: string): unknown[] {
  return [
    creatorId, item.id, item.title, item.kind, item.seconds, item.preview, item.folder, tags,
    item.listId, item.listName, item.description, item.uploadedAt, item.priceCents, item.salesCount, item.sentCount, syncedAt,
  ];
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

function iso(value: Date | string | null): string | null {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}
