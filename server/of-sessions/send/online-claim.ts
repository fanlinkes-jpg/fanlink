import { createHash } from "node:crypto";
import type { ReadSql } from "../sync/store.ts";

export const ONLINE_DEDUPE_MS = 30 * 60 * 1000;
/** Un `sending` más viejo que esto se marca para resolver a mano. No se reenvía. */
export const ONLINE_SENDING_STALE_MS = 10 * 60 * 1000;
export const ONLINE_STALE_REASON = "Hay que resolver";

export type OnlineClaimState = "nuevo" | "enviado" | "comprobar";

export type OnlineClaimResult = {
  state: OnlineClaimState;
  id: string;
};

/** Texto, precio y medios. Un PPV distinto no queda bloqueado. Sin cubo de reloj. */
export function onlineDedupeKey(input: { text: string; priceCents: number | null; mediaIds: readonly number[] }): string {
  const text = input.text.replace(/\s+/g, " ").trim();
  const price = input.priceCents != null && input.priceCents > 0 ? input.priceCents : 0;
  const media = input.mediaIds.filter((id) => Number.isSafeInteger(id) && id > 0).slice().sort((left, right) => left - right);
  return createHash("sha256").update(`${text}\n${price}\n${media.join(",")}`).digest("hex").slice(0, 40);
}

/**
 * Ventana deslizante de 30 minutos, dentro de un candado de la transacción.
 * Un `sending` de cualquier edad bloquea: no se reenvía solo.
 * La fila nueva nace ya en `sending`, antes del POST.
 */
export async function claimOnlineOutbound(sql: ReadSql, input: {
  batchId: string;
  creatorId: string;
  fanKey: string;
  authorId: string;
  body: string;
  priceCents: number | null;
  mediaIds: readonly number[];
  nowMs: number;
}): Promise<OnlineClaimResult> {
  const dedupeKey = onlineDedupeKey({ text: input.body, priceCents: input.priceCents, mediaIds: input.mediaIds });
  const id = `${input.batchId}:${input.fanKey}`;
  const cutoff = new Date(input.nowMs - ONLINE_DEDUPE_MS).toISOString();
  const createdAt = new Date(input.nowMs).toISOString();
  const rows = await sql.query<{ id: string; state: OnlineClaimState }>(
    `with lock_row as (
       select pg_advisory_xact_lock(hashtext($1)::bigint) as locked
     ),
     recent as (
       select id, status, of_message_key
       from of_chat_outbound
       where creator_id = $2 and fan_key = $3 and dedupe_key = $4
         and (status = 'sending' or created_at > $5::timestamptz)
       order by created_at desc
       limit 1
     ),
     taken as (
       update of_chat_outbound
       set status = 'sending', error_reason = null
       where id = (select id from recent where status = 'error' and of_message_key is null)
         and status = 'error'
       returning id
     ),
     inserted as (
       insert into of_chat_outbound
         (id, creator_id, thread_key, fan_key, author_id, body, price_cents, created_at, status, dedupe_key)
       select $6, $2, $3, $3, $7, $8, $9, $10::timestamptz, 'sending', $4
       where not exists (select 1 from recent)
         and not exists (select 1 from taken)
         and exists (select 1 from lock_row)
       returning id
     )
     select
       coalesce((select id from inserted), (select id from taken), (select id from recent), $6) as id,
       case
         when exists (select 1 from inserted) then 'nuevo'
         when exists (select 1 from taken) then 'nuevo'
         when (select status from recent) = 'sent' or (select of_message_key from recent) is not null then 'enviado'
         else 'comprobar'
       end as state`,
    [
      `${input.creatorId}\n${input.fanKey}\n${dedupeKey}`,
      input.creatorId,
      input.fanKey,
      dedupeKey,
      cutoff,
      id,
      input.authorId,
      input.body,
      input.priceCents,
      createdAt,
    ],
  );
  const row = rows[0];
  if (!row || (row.state !== "nuevo" && row.state !== "enviado" && row.state !== "comprobar")) {
    return { state: "comprobar", id };
  }
  return { state: row.state, id: row.id };
}

/** Marca los `sending` viejos. No cambia el estado y no reenvía. */
export async function noteStaleOnlineSends(sql: ReadSql, nowMs: number): Promise<string[]> {
  const cutoff = new Date(nowMs - ONLINE_SENDING_STALE_MS).toISOString();
  const rows = await sql.query<{ id: string }>(
    `update of_chat_outbound
     set error_reason = $2
     where status = 'sending'
       and created_at < $1::timestamptz
       and coalesce(error_reason, '') <> $2
     returning id`,
    [cutoff, ONLINE_STALE_REASON],
  );
  for (const row of rows) console.info(`[fanlink:online] envío colgado id=${row.id}`);
  return rows.map((row) => row.id);
}

/** Tras mirar OnlyFans. No hace POST. */
export async function resolveStaleOnlineSend(sql: ReadSql, id: string, outcome: "sent" | "error"): Promise<boolean> {
  if (outcome === "sent") {
    const rows = await sql.query<{ id: string }>(
      `update of_chat_outbound
       set status = 'sent', sent_at = now(), error_reason = null
       where id = $1 and status = 'sending'
       returning id`,
      [id],
    );
    if (rows[0]) console.info(`[fanlink:online] resuelto id=${id} estado=sent`);
    return Boolean(rows[0]);
  }
  const rows = await sql.query<{ id: string }>(
    `update of_chat_outbound
     set status = 'error', error_reason = 'No salió'
     where id = $1 and status = 'sending'
     returning id`,
    [id],
  );
  if (rows[0]) console.info(`[fanlink:online] resuelto id=${id} estado=error`);
  return Boolean(rows[0]);
}

export async function finishOnlineOutbound(
  sql: ReadSql,
  id: string,
  status: "enviado" | "fallido",
  messageId: string | null,
  reason: string | null,
): Promise<void> {
  if (status === "enviado") {
    await sql.query(
      `update of_chat_outbound
       set status = 'sent', of_message_key = $2, sent_at = now(), error_reason = null
       where id = $1 and status = 'sending'`,
      [id, messageId ?? id],
    );
    return;
  }
  await sql.query(
    `update of_chat_outbound
     set status = 'error', error_reason = $2
     where id = $1 and status = 'sending'`,
    [id, (reason ?? "No se pudo leer.").slice(0, 180)],
  );
}
