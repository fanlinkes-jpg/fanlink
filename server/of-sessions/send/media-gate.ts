import type { ReadSql } from "../sync/store.ts";

/**
 * Un borrador con medios no se envía: el envío real de medios no existe.
 * El texto solo saldría, y el fan no recibiría la pieza.
 */
export function mediaSendGate(mediaCount: number): { allowed: boolean; reason: string } {
  if (mediaCount === 0) return { allowed: true, reason: "" };
  return { allowed: false, reason: "El envío de medios no existe" };
}

export async function outboundMediaCount(sql: ReadSql, outboundId: string): Promise<number> {
  const rows = await sql.query<{ n: number | string }>(
    "select count(*)::int as n from of_outbound_media where outbound_id = $1",
    [outboundId],
  );
  return Number(rows[0]?.n ?? 0);
}

export async function gateOutboundSend(sql: ReadSql, outboundId: string): Promise<{ allowed: boolean; reason: string }> {
  return mediaSendGate(await outboundMediaCount(sql, outboundId));
}

/** compose y deliverChatSend pasan por aquí antes de escribir. Si hay medios, no se abre el envío. */
export async function deliverIfNoMedia(
  sql: ReadSql,
  outboundId: string,
  send: () => Promise<void>,
): Promise<{ sent: boolean; reason: string | null }> {
  const gate = await gateOutboundSend(sql, outboundId);
  if (!gate.allowed) return { sent: false, reason: gate.reason };
  await send();
  return { sent: true, reason: null };
}
