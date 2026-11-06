import type { ReadSql } from "./store.ts";

export type FanNote = {
  creatorId: string;
  fanKey: string;
  body: string;
  authorId: string;
  authorName: string | null;
  updatedAt: string;
};

type NoteRow = {
  creator_id: string;
  fan_key: string;
  body: string;
  updated_by: string;
  author_name: string | null;
  updated_at: Date | string;
};

export async function listFanNotes(sql: ReadSql, creatorIds: string[]): Promise<FanNote[]> {
  if (!creatorIds.length) return [];
  const filter = creatorIds.map((_, index) => `$${index + 1}`).join(", ");
  const rows = await sql.query<NoteRow>(
    `select n.creator_id, n.fan_key, n.body, n.updated_by, p.display_name as author_name, n.updated_at
     from of_fan_note n
     left join staff_profile p on p.user_id = n.updated_by
     where n.creator_id in (${filter})`,
    creatorIds,
  );
  return rows.map((row) => ({
    creatorId: row.creator_id,
    fanKey: row.fan_key,
    body: row.body,
    authorId: row.updated_by,
    authorName: row.author_name,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
  }));
}

export async function saveFanNote(
  sql: ReadSql,
  note: { creatorId: string; fanKey: string; body: string; updatedBy: string },
): Promise<void> {
  await sql.query(
    `insert into of_fan_note (creator_id, fan_key, body, updated_by, updated_at)
     values ($1, $2, $3, $4, now())
     on conflict (creator_id, fan_key) do update set
       body = excluded.body,
       updated_by = excluded.updated_by,
       updated_at = now()`,
    [note.creatorId, note.fanKey, note.body, note.updatedBy],
  );
}
