import { purchasedPpvSeries, type PpvPoint } from "../../../src/lib/composer-tools.ts";
import type { ReadSql } from "./store.ts";

export type FanPurchaseSeries = { maxCents: number | null; avgCents: number | null; points: PpvPoint[] };

const EMPTY: FanPurchaseSeries = { maxCents: null, avgCents: null, points: [] };

/**
 * Compras reales del fan: movimientos de mensaje, avisos de compra y PPV
 * del hilo marcados como pagados. No inventa importes que no están guardados.
 */
export async function fanPurchaseSeries(sql: ReadSql, creatorId: string, threadKey: string): Promise<FanPurchaseSeries> {
  const threads = await sql.query<{ fan_key: string | null }>(
    "select fan_key from of_chat_thread where creator_id = $1 and thread_key = $2",
    [creatorId, threadKey],
  );
  const fanKey = threads[0]?.fan_key ?? threadKey;
  const messages = await sql.query<{ sent_at: Date | string; price_cents: number | string | null; purchased: boolean | string | null; from_fan: boolean | string }>(
    `select sent_at, price_cents, purchased, from_fan from of_chat_message
     where creator_id = $1 and thread_key = $2`,
    [creatorId, threadKey],
  );
  const transactions = await sql.query<{ occurred_at: Date | string; gross_cents: number | string }>(
    `select occurred_at, gross_cents from of_transaction
     where creator_id = $1 and fan_key = $2 and kind = 'message' and gross_cents > 0`,
    [creatorId, fanKey],
  );
  const notices = await sql.query<{ occurred_at: Date | string | null; amount_cents: number | string | null }>(
    `select occurred_at, amount_cents from of_notification
     where creator_id = $1
       and amount_cents > 0
       and (kind = 'ppv' or of_type = 'purchases')
       and (
         thread_key = $2 or fan_key = $3 or message_ref like $4
       )`,
    [creatorId, threadKey, fanKey, `t:${threadKey}/%`],
  );
  return purchasedPpvSeries(
    messages.map((row) => ({
      fromFan: row.from_fan === true || row.from_fan === "t" || row.from_fan === "true",
      purchased: row.purchased === true || row.purchased === "t" || row.purchased === "true",
      priceCents: row.price_cents == null ? null : Number(row.price_cents),
      sentAt: iso(row.sent_at),
    })),
    [
      transactions.map((row) => ({ sentAt: iso(row.occurred_at), priceCents: Number(row.gross_cents) })),
      notices.flatMap((row) => {
        const sentAt = iso(row.occurred_at);
        const priceCents = row.amount_cents == null ? 0 : Number(row.amount_cents);
        return sentAt && priceCents > 0 ? [{ sentAt, priceCents }] : [];
      }),
    ],
  );
}

export function emptyFanPurchases(): FanPurchaseSeries {
  return EMPTY;
}

function iso(value: Date | string | null | undefined): string {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString();
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : "";
}
