import type { VaultBlock } from "./vault.ts";

export type ComposerAttachment = {
  id: string;
  title: string | null;
  couple?: string | null;
  act?: string | null;
};

/** Tope de un PPV en OnlyFans: 200 USD. */
export const MAX_PPV_CENTS = 20_000;

const MIN_GUARDED_CHARS = 3;

/**
 * El texto del borrador es lo que escribió el chatter.
 * Una línea `[adjunto]` es la marca del compositor, no una frase suya.
 */
export function composerDraft(text: string, attachments: ComposerAttachment[]): { body: string; mediaIds: string[] } {
  const body = text
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

/**
 * El título y el acto, si tienen cuerpo bastante y son palabras completas,
 * no se borran del texto: se rechaza el borrador. La pareja no cuenta.
 * Los acentos no distinguen. Una letra o un número no cuentan.
 */
export function vaultTextNotice(text: string, attachments: ComposerAttachment[]): string | null {
  const foldedText = foldWords(text);
  for (const item of attachments) {
    if (guardedPhrase(foldedText, item.title)) return "Quita el título del mensaje";
    if (guardedPhrase(foldedText, item.act)) return "Quita el acto del mensaje";
  }
  return null;
}

/** Gratis, o un PPV de 3 a 200 USD en céntimos enteros. */
export function validOutboundPrice(cents: number | null): { ok: true; cents: number | null } | { ok: false; notice: string } {
  if (cents == null) return { ok: true, cents: null };
  if (!Number.isInteger(cents) || cents < 0) return { ok: false, notice: "Precio no válido" };
  if (cents === 0) return { ok: true, cents: null };
  if (cents < 300 || cents > MAX_PPV_CENTS) return { ok: false, notice: "Precio no válido" };
  return { ok: true, cents };
}

export function prepareOutbound(
  text: string,
  attachments: ComposerAttachment[],
  blocked: VaultBlock | string | null,
): { ok: true; body: string; mediaIds: string[] } | { ok: false; notice: string } {
  if (blocked) return { ok: false, notice: blocked };
  const notice = vaultTextNotice(text, attachments);
  if (notice) return { ok: false, notice };
  const draft = composerDraft(text, attachments);
  if (!draft.body && draft.mediaIds.length === 0) return { ok: false, notice: "Escribe un mensaje." };
  return { ok: true, body: draft.body, mediaIds: draft.mediaIds };
}

function guardedPhrase(foldedText: string, phrase: string | null | undefined): boolean {
  const folded = foldWords(phrase ?? "");
  if (folded.length < MIN_GUARDED_CHARS || /^\d+$/.test(folded)) return false;
  return new RegExp(`(^| )${escapeRegExp(folded)}( |$)`).test(foldedText);
}

function foldWords(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
