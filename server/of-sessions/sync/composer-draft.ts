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

/** El texto del borrador es lo que escribió el chatter. */
export function composerDraft(text: string, attachments: ComposerAttachment[]): { body: string; mediaIds: string[] } {
  const body = text
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
 * no se borran del texto: se rechaza el borrador y el aviso dice la palabra.
 * La pareja no cuenta. Los acentos no distinguen. Una letra o un número no cuentan.
 * Una línea que empieza por [adjunto] también se rechaza.
 */
export function vaultTextNotice(text: string, attachments: ComposerAttachment[]): string | null {
  if (text.split("\n").some((line) => /^\[adjunto\]/i.test(line.trim()))) {
    return "Quita la marca [adjunto] del mensaje";
  }
  const foldedText = foldWords(text);
  for (const item of attachments) {
    const title = guardedPhrase(foldedText, item.title);
    if (title) return `Quita «${title}» del mensaje`;
    const act = guardedPhrase(foldedText, item.act);
    if (act) return `Quita «${act}» del mensaje`;
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

function guardedPhrase(foldedText: string, phrase: string | null | undefined): string | null {
  const raw = phrase?.trim() ?? "";
  const folded = foldWords(raw);
  if (folded.length < MIN_GUARDED_CHARS || /^\d+$/.test(folded)) return null;
  if (!new RegExp(`(^| )${escapeRegExp(folded)}( |$)`, "u").test(foldedText)) return null;
  return raw;
}

function foldWords(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
