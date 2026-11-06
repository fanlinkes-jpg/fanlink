import type { ReadSql } from "../sync/store.ts";

/** Lo llama el simulador cuando un envío de prueba termina. No abre OnlyFans. */
export async function recordCampaignResult(
  sql: ReadSql,
  draftId: string,
  result: { purchases: number; revenueCents: number },
): Promise<void> {
  await sql.query(
    `insert into of_campaign_result (draft_id, purchases, revenue_cents)
     values ($1, $2, $3)
     on conflict (draft_id) do update set
       purchases = excluded.purchases,
       revenue_cents = excluded.revenue_cents,
       recorded_at = now()`,
    [draftId, result.purchases, result.revenueCents],
  );
}

export function campaignConversion(recipients: number, purchases: number | null): number | null {
  if (purchases == null || recipients <= 0) return null;
  return purchases / recipients;
}
