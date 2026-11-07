import type { ReadSql } from "../sync/store.ts";

/**
 * Sin medios, el texto puede salir. Con piezas de la bóveda, solo si el
 * llamador ya pasó FANLINK_ENABLE_SEND y la allowlist (apagado por defecto).
 */
export function mediaSendGate(mediaCount: number, allowVaultMedia = false): { allowed: boolean; reason: string } {
  if (mediaCount === 0 || allowVaultMedia) return { allowed: true, reason: "" };
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

/** Si allowVaultMedia es false, una pieza no abre el navegador. */
export async function deliverIfNoMedia(
  sql: ReadSql,
  outboundId: string,
  send: () => Promise<void>,
  allowVaultMedia = false,
): Promise<{ sent: boolean; reason: string | null }> {
  const gate = mediaSendGate(await outboundMediaCount(sql, outboundId), allowVaultMedia);
  if (!gate.allowed) return { sent: false, reason: gate.reason };
  await send();
  return { sent: true, reason: null };
}
