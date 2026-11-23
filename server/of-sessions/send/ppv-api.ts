import { onlineChatId, onlineMessageBody, onlineMessagePath } from "./online-broadcast.ts";

export type PpvApiBody = ReturnType<typeof onlineMessageBody>;

/**
 * POST /api2/v2/chats/{fan}/messages. El precio va en dólares.
 * `previews` son los ids que el fan ve gratis. El resto queda de pago.
 */
export function buildPpvPost(input: {
  fanId: string;
  text: string;
  priceCents: number | null;
  mediaIds: readonly string[];
  previewIds: readonly string[];
}): { ok: true; path: string; body: PpvApiBody } | { ok: false; reason: string } {
  const fanId = onlineChatId(input.fanId);
  if (!fanId) return { ok: false, reason: "Sin datos" };
  const mediaFiles = numericIds(input.mediaIds);
  if (!mediaFiles || mediaFiles.length === 0) return { ok: false, reason: "Sin datos" };
  const previews = numericIds(input.previewIds);
  if (!previews) return { ok: false, reason: "No está la vista previa" };
  const media = new Set(mediaFiles);
  if (previews.some((id) => !media.has(id))) return { ok: false, reason: "No está la vista previa" };
  const price = input.priceCents != null && input.priceCents > 0 ? input.priceCents / 100 : 0;
  if (price > 0 && input.previewIds.length > 0 && previews.length === 0) {
    return { ok: false, reason: "No está la vista previa" };
  }
  const text = input.text.replace(/\s+/g, " ").trim();
  return {
    ok: true,
    path: onlineMessagePath(fanId),
    body: { ...onlineMessageBody({ text, mediaIds: mediaFiles, price }), previews },
  };
}

export function ppvDryRun(env: NodeJS.ProcessEnv): boolean {
  const raw = env.FANLINK_SEND_DRY_RUN?.trim().toLowerCase();
  return raw === "true" || raw === "1";
}

/** Arma el cuerpo y, en seco, lo anota sin hacer el POST. */
export async function deliverPpvPost(input: {
  fanId: string;
  text: string;
  priceCents: number | null;
  mediaIds: readonly string[];
  previewIds: readonly string[];
  dryRun: boolean;
  request: (path: string, body: PpvApiBody) => Promise<{ status: number; json: unknown; retryAfterMs: number }>;
  log?: (line: string) => void;
}): Promise<{ messageId: string | null; reason: string | null; dryRun: boolean }> {
  const built = buildPpvPost(input);
  if (!built.ok) return { messageId: null, reason: built.reason, dryRun: false };
  const line = ppvLogLine(built.body);
  if (input.dryRun) {
    (input.log ?? console.info)(`[fanlink:send] dry-run ${line}`);
    return { messageId: null, reason: "Envío en seco", dryRun: true };
  }
  const response = await input.request(built.path, built.body);
  if (response.status === 429 || response.retryAfterMs > 0) {
    return { messageId: null, reason: "OnlyFans respondió 429", dryRun: false };
  }
  if (response.status < 200 || response.status >= 300) {
    return { messageId: null, reason: "No se envió", dryRun: false };
  }
  const messageId = messageIdOf(response.json);
  if (!messageId) return { messageId: null, reason: "Pendiente de confirmar", dryRun: false };
  return { messageId, reason: null, dryRun: false };
}

export function ppvLogLine(body: PpvApiBody): string {
  return `price=${body.price} mediaFiles=${body.mediaFiles.join(",")} previews=${body.previews.join(",")}`;
}

function numericIds(ids: readonly string[]): number[] | null {
  const out: number[] = [];
  for (const raw of ids) {
    if (!/^\d{1,18}$/.test(raw)) return null;
    out.push(Number(raw));
  }
  return out;
}

function messageIdOf(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const direct = record.id;
  if (typeof direct === "number" && Number.isFinite(direct)) return String(Math.trunc(direct));
  if (typeof direct === "string" && /^\d{1,18}$/.test(direct.trim())) return direct.trim();
  return null;
}
