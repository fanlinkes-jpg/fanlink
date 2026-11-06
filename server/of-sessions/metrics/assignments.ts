import { randomBytes } from "node:crypto";
import type { ReadSql } from "../sync/store.ts";

/** Cierra la asignación de quien ya no tiene la creadora y abre la de quien entra. */
export async function syncAssignments(sql: ReadSql, creatorId: string, now = new Date()): Promise<void> {
  const grants = await sql.query<{ user_id: string }>("select user_id from creator_grant where creator_id = $1", [creatorId]);
  const wanted = new Set(grants.map((row) => row.user_id));
  const open = await sql.query<{ id: string; user_id: string }>(
    "select id, user_id from of_assignment where creator_id = $1 and ended_at is null",
    [creatorId],
  );
  const stamp = now.toISOString();
  for (const row of open) {
    if (wanted.has(row.user_id)) continue;
    await sql.query("update of_assignment set ended_at = $2 where id = $1", [row.id, stamp]);
  }
  const openIds = new Set(open.filter((row) => wanted.has(row.user_id)).map((row) => row.user_id));
  for (const userId of wanted) {
    if (openIds.has(userId)) continue;
    await sql.query(
      "insert into of_assignment (id, creator_id, user_id, started_at) values ($1, $2, $3, $4)",
      [`asg_${randomBytes(8).toString("hex")}`, creatorId, userId, stamp],
    );
  }
}
