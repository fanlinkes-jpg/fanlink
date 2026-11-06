import type { VaultBlock } from "./vault.ts";

export type ComposerAttachment = {
  id: string;
  title: string | null;
  couple?: string | null;
  act?: string | null;
};

/**
 * El texto del borrador es solo lo que escribió el chatter.
 * El medio viaja por su id. Título, pareja y acto no entran en el cuerpo.
 */
export function composerDraft(text: string, attachments: ComposerAttachment[]): { body: string; mediaIds: string[] } {
  let body = text;
  const phrases = attachments
    .flatMap((item) => [item.title, item.couple, item.act])
    .map((phrase) => phrase?.trim() ?? "")
    .filter(Boolean)
    .sort((left, right) => right.length - left.length);
  for (const phrase of phrases) {
    body = body.replace(new RegExp(escapeRegExp(phrase), "gi"), " ");
  }
  body = body
    .split("\n")
    .filter((line) => !/^\[adjunto\]/i.test(line.trim()))
    .join("\n")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .trim();
  return {
    body,
    mediaIds: attachments.map((item) => item.id).filter(Boolean),
  };
}

/** Gratis, o un PPV de al menos 3 USD en céntimos enteros. */
export function validOutboundPrice(cents: number | null): { ok: true; cents: number | null } | { ok: false; notice: string } {
  if (cents == null) return { ok: true, cents: null };
  if (!Number.isInteger(cents) || cents < 0) return { ok: false, notice: "Precio no válido" };
  if (cents === 0) return { ok: true, cents: null };
  if (cents < 300) return { ok: false, notice: "Precio no válido" };
  return { ok: true, cents };
}

export function prepareOutbound(
  text: string,
  attachments: ComposerAttachment[],
  blocked: VaultBlock | string | null,
): { ok: true; body: string; mediaIds: string[] } | { ok: false; notice: string } {
  if (blocked) return { ok: false, notice: blocked };
  const draft = composerDraft(text, attachments);
  if (!draft.body && draft.mediaIds.length === 0) return { ok: false, notice: "Escribe un mensaje." };
  return { ok: true, body: draft.body, mediaIds: draft.mediaIds };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
