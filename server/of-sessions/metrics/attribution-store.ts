import type { Attribution, MassLaunch, SaleKind } from "./team.ts";

export type AttributionSql = {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

/**
 * Guarda la atribución de cada venta. Se escribe una vez: si ya tiene chatter no se reasigna a otro,
 * y si el empleado se borra la fila conserva su nombre. Una venta sin chatter puede completarse más tarde.
 */
export async function persistAttributions(sql: AttributionSql, rows: Attribution[]): Promise<void> {
  for (const row of rows) {
    await sql.query(
      `insert into of_sale_attribution
         (sale_key, creator_id, fan_key, kind, sold_at, gross_cents, chatter_id, chatter_name, rule)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       on conflict (sale_key) do update set
         gross_cents = excluded.gross_cents,
         chatter_id = coalesce(of_sale_attribution.chatter_id, excluded.chatter_id),
         chatter_name = coalesce(of_sale_attribution.chatter_name, excluded.chatter_name),
         rule = case when of_sale_attribution.chatter_id is null then excluded.rule else of_sale_attribution.rule end,
         kind = case when of_sale_attribution.chatter_id is null then excluded.kind else of_sale_attribution.kind end`,
      [row.saleKey, row.creatorId, row.fanKey, row.kind, row.at, row.grossCents, row.chatterId, row.chatterName, row.rule],
    );
  }
}

type StoredRow = {
  sale_key: string;
  creator_id: string;
  fan_key: string | null;
  kind: string;
  sold_at: Date | string;
  gross_cents: number | string;
  chatter_id: string | null;
  chatter_name: string | null;
  rule: string;
};

/** Lo guardado, de las creadoras pedidas. Sin lista, todas. */
export async function readAttributions(sql: AttributionSql, creatorIds?: readonly string[]): Promise<Attribution[]> {
  const rows = creatorIds
    ? await sql.query<StoredRow>(
        "select sale_key, creator_id, fan_key, kind, sold_at, gross_cents, chatter_id, chatter_name, rule from of_sale_attribution where creator_id = any($1::text[]) order by sold_at, sale_key",
        [[...creatorIds]],
      )
    : await sql.query<StoredRow>(
        "select sale_key, creator_id, fan_key, kind, sold_at, gross_cents, chatter_id, chatter_name, rule from of_sale_attribution order by sold_at, sale_key",
      );
  return rows.map((row) => ({
    saleKey: row.sale_key,
    creatorId: row.creator_id,
    fanKey: row.fan_key,
    kind: row.kind as SaleKind,
    at: row.sold_at instanceof Date ? row.sold_at.toISOString() : new Date(row.sold_at).toISOString(),
    grossCents: Number(row.gross_cents),
    chatterId: row.chatter_id,
    chatterName: row.chatter_name,
    rule: row.rule as Attribution["rule"],
  }));
}

/** Quién lanzó cada masivo: quien lo creó. */
export async function readMassLaunches(sql: AttributionSql): Promise<MassLaunch[]> {
  try {
    const rows = await sql.query<{ id: string; created_by_id: string | null; created_by_name: string | null }>(
      "select id, created_by_id, created_by_name from of_mass_message",
    );
    return rows.map((row) => ({ massId: row.id, userId: row.created_by_id, name: row.created_by_name }));
  } catch {
    return [];
  }
}
