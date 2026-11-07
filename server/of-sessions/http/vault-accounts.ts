import type { ReadSql } from "../sync/store.ts";

/** Ids de creadora ligados a una sesión. Si la tabla no está, no hay cuentas. */
export async function accountCreatorIds(sql: ReadSql): Promise<string[]> {
  try {
    const rows = await sql.query<{ creator_id: string }>("select creator_id from of_session_account");
    return rows.map((row) => row.creator_id).filter((id) => id.trim().length > 0);
  } catch {
    return [];
  }
}
