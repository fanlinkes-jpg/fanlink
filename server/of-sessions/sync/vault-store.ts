import { decodeMedia } from "./history.ts";
import type { ReadSql } from "./store.ts";
import { inheritedBlock, sendBlock, type VaultBlock, type VaultFolder, type VaultItem, type VaultRead, type VaultSend } from "./vault.ts";

export async function saveVaultRead(sql: ReadSql, creatorId: string, read: VaultRead, now = new Date()): Promise<void> {
  const syncedAt = now.toISOString();
  for (const folder of read.folders) {
    await sql.query(
      `insert into of_vault_folder (creator_id, folder_id, name, parent_id)
       values ($1, $2, $3, $4)
       on conflict (creator_id, folder_id) do update set name = excluded.name, parent_id = excluded.parent_id`,
      [creatorId, folder.id, folder.name, folder.parentId],
    );
  }
  for (const item of read.items) {
    await sql.query(
      `insert into of_vault_item (
         creator_id, media_id, title, kind, seconds, preview, full_url, created_at, folder_id, tags,
         price_cents, sales, trailer, couple, act, blocked, synced_at
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       on conflict (creator_id, media_id) do update set
         title = excluded.title, kind = excluded.kind, seconds = excluded.seconds, preview = excluded.preview,
         full_url = excluded.full_url, created_at = excluded.created_at, folder_id = excluded.folder_id,
         tags = excluded.tags, price_cents = excluded.price_cents, sales = excluded.sales, trailer = excluded.trailer,
         couple = excluded.couple, act = excluded.act, blocked = excluded.blocked, synced_at = excluded.synced_at`,
      [
        creatorId, item.id, item.title, item.kind, item.seconds, item.preview, item.full, item.createdAt,
        item.folderId, item.tags.join(","), item.priceCents, item.sales, item.trailer, item.couple, item.act,
        item.blocked, syncedAt,
      ],
    );
  }
  if (read.cursor || read.done) {
    await sql.query(
      `insert into of_vault_cursor (creator_id, cursor_text, done) values ($1, $2, $3)
       on conflict (creator_id) do update set cursor_text = excluded.cursor_text, done = excluded.done`,
      [creatorId, read.cursor, read.done],
    );
  }
}

export async function vaultCursor(sql: ReadSql, creatorId: string): Promise<string | null> {
  const rows = await sql.query<{ cursor_text: string | null }>(
    "select cursor_text from of_vault_cursor where creator_id = $1",
    [creatorId],
  );
  return rows[0]?.cursor_text ?? null;
}

export async function listVault(sql: ReadSql, creatorId: string): Promise<{ items: VaultItem[]; folders: VaultFolder[] }> {
  const folders = await sql.query<{ folder_id: string; name: string; parent_id: string | null }>(
    "select folder_id, name, parent_id from of_vault_folder where creator_id = $1 order by name",
    [creatorId],
  );
  const items = await sql.query<{
    media_id: string; title: string | null; kind: string | null; seconds: number | null; preview: string | null;
    full_url: string | null; created_at: Date | string | null; folder_id: string | null; tags: string | null;
    price_cents: number | null; sales: number | null; trailer: boolean | null; couple: string | null;
    act: string | null; blocked: string | null;
  }>(
    `select media_id, title, kind, seconds, preview, full_url, created_at, folder_id, tags, price_cents, sales, trailer, couple, act, blocked
     from of_vault_item where creator_id = $1 order by created_at desc nulls last`,
    [creatorId],
  );
  return {
    folders: folders.map((row) => ({ id: row.folder_id, name: row.name, parentId: row.parent_id })),
    items: items.map((row) => ({
      id: row.media_id,
      title: row.title,
      kind: row.kind === "foto" || row.kind === "video" || row.kind === "audio" ? row.kind : null,
      seconds: row.seconds,
      preview: row.preview,
      full: row.full_url,
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
      folderId: row.folder_id,
      tags: (row.tags ?? "").split(",").filter((tag) => tag === "sent" || tag === "feed"),
      priceCents: row.price_cents,
      sales: row.sales,
      trailer: row.trailer === true,
      couple: row.couple === "B/G" || row.couple === "G/G" || row.couple === "INDIVIDUAL" || row.couple === "SOLA" || row.couple === "PELICULA" ? row.couple : null,
      act: row.act,
      blocked: row.blocked === "NO VENDER" || row.blocked === "SIN EDITAR" ? row.blocked : null,
    })),
  };
}

export function blockForStored(item: VaultItem, folders: VaultFolder[]): VaultBlock | null {
  return sendBlock(item.title, item.act) ?? item.blocked ?? inheritedBlock(folders, item.folderId);
}

export async function blockForMediaIds(sql: ReadSql, creatorId: string, mediaIds: string[]): Promise<VaultBlock | null> {
  if (!mediaIds.length) return null;
  const stored = await listVault(sql, creatorId);
  for (const id of mediaIds) {
    const item = stored.items.find((row) => row.id === id);
    if (!item) continue;
    const block = blockForStored(item, stored.folders);
    if (block) return block;
  }
  return null;
}

/** Historial por fan en la base. El id del medio del chat es el de la bóveda. */
export async function sendsForFan(sql: ReadSql, creatorId: string, fanKey: string | null): Promise<VaultSend[]> {
  if (!fanKey) return [];
  const rows = await sql.query<{
    sent_at: Date | string;
    price_cents: number | null;
    purchased: boolean | string | null;
    author_name: string | null;
    media_json: string | null;
    fan_key: string | null;
  }>(
    `select m.sent_at, m.price_cents, m.purchased, p.display_name as author_name, m.media_json, m.fan_key
     from of_chat_message m
     left join staff_profile p on p.user_id = m.author_id
     where m.creator_id = $1 and m.fan_key = $2 and m.from_fan = false
     order by m.sent_at`,
    [creatorId, fanKey],
  );
  const sends: VaultSend[] = [];
  for (const row of rows) {
    if (!row.fan_key) continue;
    const purchased = row.purchased == null ? null : row.purchased === true || row.purchased === "t" || row.purchased === "true";
    const sentAt = row.sent_at instanceof Date ? row.sent_at.toISOString() : String(row.sent_at);
    for (const media of decodeMedia(row.media_json) ?? []) {
      if (!media.vaultId) continue;
      sends.push({
        mediaId: media.vaultId,
        fanKey: row.fan_key,
        sentAt,
        priceCents: row.price_cents,
        purchased,
        chatterName: row.author_name,
      });
    }
  }
  return sends;
}

export async function recordOutboundMedia(sql: ReadSql, outboundId: string, mediaIds: string[]): Promise<void> {
  for (const [position, mediaId] of mediaIds.entries()) {
    await sql.query(
      `insert into of_outbound_media (outbound_id, media_id, position) values ($1, $2, $3)
       on conflict (outbound_id, media_id) do nothing`,
      [outboundId, mediaId, position],
    );
  }
}
