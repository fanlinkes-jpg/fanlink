import { createHash } from "node:crypto";
import type { ReadSql } from "../sync/store.ts";

export const SEND_CLAIM_WINDOW_MS = 30_000;

export function sendClaimKey(input: {
  authorId: string;
  creatorId: string;
  threadKey: string;
  fanKey: string | null;
  body: string;
  priceCents: number | null;
  vaultItemIds: readonly string[];
}): string {
  const ids = input.vaultItemIds.map((id) => id.trim()).filter(Boolean).sort();
  return createHash("sha256").update([
    input.authorId,
    input.creatorId,
    input.threadKey,
    input.fanKey ?? "",
    input.body,
    String(input.priceCents ?? ""),
    ids.join(","),
  ].join("\n")).digest("hex");
}

/** La primera llamada se queda la clave. Otra igual, dentro de la ventana, no sale. */
export async function claimSend(sql: ReadSql, key: string, outboundId: string, now = new Date()): Promise<boolean> {
  const inserted = await sql.query<{ claim_key: string }>(
    `insert into of_chat_send_claim (claim_key, outbound_id, created_at)
     values ($1, $2, $3)
     on conflict (claim_key) do nothing
     returning claim_key`,
    [key, outboundId, now.toISOString()],
  );
  if (inserted.length > 0) return true;
  const rows = await sql.query<{ created_at: Date | string | null }>(
    "select created_at from of_chat_send_claim where claim_key = $1",
    [key],
  );
  const raw = rows[0]?.created_at;
  const at = raw instanceof Date ? raw.getTime() : Date.parse(String(raw ?? ""));
  if (!Number.isFinite(at) || now.getTime() - at < SEND_CLAIM_WINDOW_MS) return false;
  await sql.query(
    "update of_chat_send_claim set outbound_id = $2, created_at = $3 where claim_key = $1",
    [key, outboundId, now.toISOString()],
  );
  return true;
}

/** Solo suelta la clave el envío que la tomó, y solo si no llegó a salir. */
export async function releaseSendClaim(sql: ReadSql, key: string, outboundId: string): Promise<void> {
  await sql.query(
    "delete from of_chat_send_claim where claim_key = $1 and outbound_id = $2",
    [key, outboundId],
  );
}
