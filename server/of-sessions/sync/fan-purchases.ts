import { purchasedPpvSeries, type PpvPoint } from "../../../src/lib/composer-tools.ts";
import { decodeMedia } from "./history.ts";
import type { ReadSql } from "./store.ts";
import type { PpvMedia } from "../../../src/lib/ppv-timeline.ts";

export type PricedMessage = {
  messageKey: string;
  body: string;
  sentAt: string;
  fromFan: boolean;
  priceCents: number;
  purchased: boolean | null;
  mediaCount: number | null;
  mediaSeconds: number | null;
  mediaPreview: string | null;
  media: PpvMedia[];
};

/** `ppvs`: todos los PPV propios guardados del hilo, no solo los cargados en pantalla. */
/** Puesto del gasto del fan entre los hilos de la creadora (en neto, como lo guarda OnlyFans). */
export type SpendRank = { fans: number; above: number; mineCents: number };

export type FanPurchaseSeries = {
  maxCents: number | null;
  avgCents: number | null;
  points: PpvPoint[];
  ppvs?: PricedMessage[];
  rank?: SpendRank | null;
  /** Contracargos guardados del fan. Hoy ninguna lectura los guarda, así que 0 no prueba que no existan. */
  chargebacks?: number;
};

const EMPTY: FanPurchaseSeries = { maxCents: null, avgCents: null, points: [], ppvs: [], rank: null, chargebacks: 0 };
const MAX_PPVS = 300;
const MAX_MEDIA_PER_PPV = 12;

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
  type PricedRow = {
    message_key: string; body: string | null; sent_at: Date | string; price_cents: number | string; purchased: boolean | string | null;
    media_count?: number | string | null; media_seconds?: number | string | null; media_preview?: string | null; media_json?: string | null;
  };
  const where = `from of_chat_message where creator_id = $1 and thread_key = $2 and from_fan is not true and price_cents > 0 order by sent_at desc limit ${MAX_PPVS}`;
  // Si la base aún no tiene las columnas de medios, se lee sin ellas.
  const priced = await sql
    .query<PricedRow>(`select message_key, body, sent_at, price_cents, purchased, media_count, media_seconds, media_preview, media_json ${where}`, [creatorId, threadKey])
    .catch(() => sql.query<PricedRow>(`select message_key, body, sent_at, price_cents, purchased ${where}`, [creatorId, threadKey]))
    .catch(() => [] as PricedRow[]);
  const series = purchasedPpvSeries(
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
  return {
    ...series,
    ppvs: priced.map((row) => ({
      messageKey: row.message_key,
      body: row.body ?? "",
      sentAt: iso(row.sent_at),
      fromFan: false,
      priceCents: Number(row.price_cents),
      purchased: row.purchased == null ? null : row.purchased === true || row.purchased === "t" || row.purchased === "true",
      mediaCount: row.media_count == null ? null : Number(row.media_count),
      mediaSeconds: row.media_seconds == null ? null : Number(row.media_seconds),
      mediaPreview: row.media_preview ?? null,
      media: (decodeMedia(row.media_json ?? null) ?? []).slice(0, MAX_MEDIA_PER_PPV).map((item) => ({
        kind: item.kind,
        seconds: item.seconds,
        preview: item.preview,
        locked: item.locked,
      })),
    })),
    rank: await spendRank(sql, creatorId, threadKey),
    chargebacks: await chargebackCount(sql, creatorId, fanKey),
  };
}

async function spendRank(sql: ReadSql, creatorId: string, threadKey: string): Promise<SpendRank | null> {
  try {
    const rows = await sql.query<{ mine: number | string | null; fans: number | string; above: number | string }>(
      `select (select spent_cents from of_chat_thread where creator_id = $1 and thread_key = $2) as mine,
              count(*) filter (where spent_cents is not null) as fans,
              count(*) filter (where spent_cents > (select spent_cents from of_chat_thread where creator_id = $1 and thread_key = $2)) as above
       from of_chat_thread where creator_id = $1`,
      [creatorId, threadKey],
    );
    const row = rows[0];
    if (!row || row.mine == null) return null;
    return { fans: Number(row.fans), above: Number(row.above), mineCents: Number(row.mine) };
  } catch {
    return null;
  }
}

async function chargebackCount(sql: ReadSql, creatorId: string, fanKey: string): Promise<number> {
  try {
    const rows = await sql.query<{ n: number | string }>(
      "select count(*) as n from of_transaction where creator_id = $1 and fan_key = $2 and kind in ('chargeback', 'refund')",
      [creatorId, fanKey],
    );
    return Number(rows[0]?.n ?? 0);
  } catch {
    return 0;
  }
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
