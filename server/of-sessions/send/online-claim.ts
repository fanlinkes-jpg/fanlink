import { createHash } from "node:crypto";
import type { ReadSql } from "../sync/store.ts";

export const ONLINE_DEDUPE_MS = 30 * 60 * 1000;

export type OnlineClaimState = "nuevo" | "enviado" | "comprobar";

export type OnlineClaimResult = {
  state: OnlineClaimState;
  id: string;
};

export function onlineDedupeKey(text: string, nowMs: number): string {
  const slot = Math.floor(nowMs / ONLINE_DEDUPE_MS);
  const hash = createHash("sha256").update(text.replace(/\s+/g, " ").trim()).digest("hex").slice(0, 32);
  return `${slot}:${hash}`;
}

/**
 * Una sola fila por cuenta, fan y texto en la ventana. La inserta ya en
 * `sending`, antes del POST. Si otra pestaña la dejó en `sending`, no se reenvía.
 */
export async function claimOnlineOutbound(sql: ReadSql, input: {
  batchId: string;
  creatorId: string;
  fanKey: string;
  authorId: string;
  body: string;
  priceCents: number | null;
  nowMs: number;
}): Promise<OnlineClaimResult> {
  const dedupeKey = onlineDedupeKey(input.body, input.nowMs);
  const id = `${input.batchId}:${input.fanKey}`;
  const inserted = await sql.query<{ id: string }>(
    `insert into of_chat_outbound
       (id, creator_id, thread_key, fan_key, author_id, body, price_cents, created_at, status, dedupe_key)
     values ($1, $2, $3, $3, $4, $5, $6, $7, 'sending', $8)
     on conflict (creator_id, fan_key, dedupe_key) do nothing
     returning id`,
    [id, input.creatorId, input.fanKey, input.authorId, input.body, input.priceCents, new Date(input.nowMs).toISOString(), dedupeKey],
  );
  const created = inserted[0];
  if (created) return { state: "nuevo", id: created.id };
  const found = await sql.query<{ id: string; status: string | null; of_message_key: string | null }>(
    `select id, status, of_message_key from of_chat_outbound
     where creator_id = $1 and fan_key = $2 and dedupe_key = $3
     order by created_at desc
     limit 1`,
    [input.creatorId, input.fanKey, dedupeKey],
  );
  const row = found[0];
  if (!row) return { state: "comprobar", id };
  if (row.status === "sent" || row.of_message_key) return { state: "enviado", id: row.id };
  if (row.status !== "error") return { state: "comprobar", id: row.id };
  const taken = await sql.query<{ id: string }>(
    `update of_chat_outbound
     set status = 'sending', error_reason = null
     where id = $1 and status = 'error'
     returning id`,
    [row.id],
  );
  const next = taken[0];
  return next ? { state: "nuevo", id: next.id } : { state: "comprobar", id: row.id };
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
