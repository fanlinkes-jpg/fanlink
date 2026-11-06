import type { VaultBlock } from "./vault.ts";

export type ComposerAttachment = { id: string; title: string | null };

/**
 * El texto del borrador es solo lo que escribió el chatter.
 * El medio viaja por su id. El título de la bóveda no entra en el cuerpo.
 */
export function composerDraft(text: string, attachments: ComposerAttachment[]): { body: string; mediaIds: string[] } {
  const titles = new Set(attachments.map((item) => item.title?.trim()).filter((title): title is string => Boolean(title)));
  const lines = text.split("\n").filter((line) => {
    const trimmed = line.trim();
    if (!trimmed) return false;
    if (/^\[adjunto\]/i.test(trimmed)) return false;
    if (titles.has(trimmed)) return false;
    return true;
  });
  return {
    body: lines.join("\n").trim(),
    mediaIds: attachments.map((item) => item.id).filter(Boolean),
  };
}

export function prepareOutbound(
  text: string,
  attachments: ComposerAttachment[],
  blocked: VaultBlock | null,
): { ok: true; body: string; mediaIds: string[] } | { ok: false; notice: string } {
  if (blocked) return { ok: false, notice: blocked };
  const draft = composerDraft(text, attachments);
  if (!draft.body && draft.mediaIds.length === 0) return { ok: false, notice: "Escribe un mensaje." };
  return { ok: true, body: draft.body, mediaIds: draft.mediaIds };
}
