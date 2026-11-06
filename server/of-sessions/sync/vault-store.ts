import type { ReadSql } from "./store.ts";
import { emptyVaultQuery, vaultQueryFromUnknown, type VaultQuery } from "./vault-filter.ts";
import { historyFromMedia, historyFromSends, mergeFanUses, type FanVaultUse, type VaultFile, type VaultList } from "./vault-model.ts";

export async function saveVaultMirror(sql: ReadSql, creatorId: string, items: readonly VaultFile[], lists: readonly VaultList[], now = new Date()): Promise<void> {
  const syncedAt = now.toISOString();
  for (const list of lists) {
    await sql.query(
      `insert into of_vault_list (creator_id, list_key, name, synced_at)
       values ($1, $2, $3, $4)
       on conflict (creator_id, list_key) do update set name = excluded.name, synced_at = excluded.synced_at`,
      [creatorId, list.id, list.name, syncedAt],
    );
  }
  for (const item of items) {
    await sql.query(
      `insert into of_vault_item (
         creator_id, item_key, title, kind, seconds, preview, folder, tags, list_key, list_name,
         description, uploaded_at, price_cents, sales_count, sent_count, synced_at
       ) values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12, $13, $14, $15, $16)
       on conflict (creator_id, item_key) do update set
         title = excluded.title, kind = excluded.kind, seconds = excluded.seconds, preview = excluded.preview,
         folder = excluded.folder, tags = excluded.tags, list_key = excluded.list_key, list_name = excluded.list_name,
         description = excluded.description, uploaded_at = excluded.uploaded_at, price_cents = excluded.price_cents,
         sales_count = excluded.sales_count, sent_count = excluded.sent_count, synced_at = excluded.synced_at`,
      [
        creatorId, item.id, item.title, item.kind, item.seconds, item.preview, item.folder, JSON.stringify(item.tags),
        item.listId, item.listName, item.description, item.uploadedAt, item.priceCents, item.salesCount, item.sentCount, syncedAt,
      ],
    );
  }
  await sql.query(
    `insert into of_vault_sync (creator_id, synced_at) values ($1, $2)
     on conflict (creator_id) do update set synced_at = excluded.synced_at`,
    [creatorId, syncedAt],
  );
}

export async function loadVaultMirror(sql: ReadSql, creatorId: string): Promise<{ items: VaultFile[]; lists: VaultList[]; syncedAt: string | null }> {
  const lists = await sql.query<{ list_key: string; name: string }>(
    "select list_key, name from of_vault_list where creator_id = $1 order by name",
    [creatorId],
  );
  const items = await sql.query<{
    item_key: string; title: string | null; kind: string | null; seconds: number | null; preview: string | null;
    folder: string | null; tags: unknown; list_key: string | null; list_name: string | null;
    description: string | null; uploaded_at: Date | string | null; price_cents: number | null;
    sales_count: number | null; sent_count: number | null;
  }>(
    `select item_key, title, kind, seconds, preview, folder, tags, list_key, list_name,
            description, uploaded_at, price_cents, sales_count, sent_count
     from of_vault_item where creator_id = $1 order by title`,
    [creatorId],
  );
  const sync = await sql.query<{ synced_at: Date | string | null }>(
    "select synced_at from of_vault_sync where creator_id = $1",
    [creatorId],
  );
  return {
    lists: lists.map((row) => ({ id: row.list_key, name: row.name })),
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
      salesCount: row.sales_count ?? 0,
      sentCount: row.sent_count ?? 0,
    })),
    syncedAt: sync[0]?.synced_at == null ? null : sync[0].synced_at instanceof Date ? sync[0].synced_at.toISOString() : String(sync[0].synced_at),
  };
}

export async function fanVaultUses(sql: ReadSql, creatorId: string, fanKey: string): Promise<FanVaultUse[]> {
  const messages = await sql.query<{
    fan_key: string | null; from_fan: boolean; sent_at: Date | string | null; price_cents: number | null;
    purchased: boolean | null; author_id: string | null; media_json: string | null;
  }>(
    `select fan_key, from_fan, sent_at, price_cents, purchased, author_id, media_json
     from of_chat_message where creator_id = $1 and fan_key = $2`,
    [creatorId, fanKey],
  );
  const sends = await sql.query<{
    fan_key: string; item_key: string; sent_at: Date | string | null; price_cents: number | null;
    purchased: boolean | null; author_id: string | null;
  }>(
    `select fan_key, item_key, sent_at, price_cents, purchased, author_id
     from of_vault_fan_send where creator_id = $1 and fan_key = $2`,
    [creatorId, fanKey],
  ).catch(() => []);
  return mergeFanUses([
    ...historyFromMedia(messages.map((row) => ({
      fanKey: row.fan_key,
      fromFan: row.from_fan === true,
      sentAt: iso(row.sent_at),
      priceCents: row.price_cents,
      purchased: row.purchased,
      authorId: row.author_id,
      mediaJson: row.media_json,
    }))),
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
