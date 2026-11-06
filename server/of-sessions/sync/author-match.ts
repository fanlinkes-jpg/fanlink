export type OutboundDraft = {
  id: string;
  authorId: string;
  body: string;
  priceCents: number | null;
  createdAt: string;
  threadKey: string | null;
  fanKey: string | null;
  ofMessageKey: string | null;
  scheduledAt?: string | null;
};

export type MatchableMessage = {
  messageKey: string;
  threadKey: string;
  fanKey: string | null;
  body: string;
  sentAt: string;
  priceCents: number | null;
};

const WINDOW_MS = 2 * 60 * 60 * 1000;
export const OUTBOUND_TIE_MS = 60_000;

/**
 * Casa un mensaje leído de OnlyFans con el borrador del chatter.
 * Si dos autores quedan a menos de 60 s con el mismo texto, no se atribuye
 * a ninguno: el orden de la lista no desempata.
 */
export function matchOutboundAuthor(message: MatchableMessage, drafts: OutboundDraft[]): { draftId: string; authorId: string } | null {
  const byId = drafts.find((draft) => draft.ofMessageKey != null && draft.ofMessageKey === message.messageKey);
  if (byId) return { draftId: byId.id, authorId: byId.authorId };
  const ranked = drafts.flatMap((draft) => {
    const delta = outboundTextDelta(message, draft);
    return delta == null ? [] : [{ draft, delta }];
  }).sort((left, right) => left.delta - right.delta);
  const best = ranked[0];
  if (!best) return null;
  const next = ranked[1];
  if (next && next.draft.authorId !== best.draft.authorId && next.delta - best.delta < OUTBOUND_TIE_MS) return null;
  return { draftId: best.draft.id, authorId: best.draft.authorId };
}

/** Distancia en ms si el texto, el precio y la ventana de 2 h casan. */
export function outboundTextDelta(message: MatchableMessage, draft: OutboundDraft): number | null {
  const text = normalize(message.body);
  if (!text || normalize(draft.body) !== text) return null;
  if (draft.priceCents != null && message.priceCents != null && draft.priceCents !== message.priceCents) return null;
  const delta = Math.abs(Date.parse(message.sentAt) - Date.parse(draft.createdAt));
  if (!Number.isFinite(delta) || delta > WINDOW_MS) return null;
  return delta;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: "\"",
  apos: "'",
  nbsp: " ",
  hellip: "...",
  mdash: "-",
  ndash: "-",
};

/** Texto comparable: etiquetas, entidades (&amp; y similares) y la variante del emoji. */
export function normalizeOutboundText(value: string): string {
  const stripped = value.replace(/<[^>]*>/g, " ");
  let decoded = stripped;
  for (let pass = 0; pass < 2; pass += 1) {
    const next = decoded.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, body: string) => {
      const token = body.toLowerCase();
      const code = token.startsWith("#x")
        ? Number.parseInt(token.slice(2), 16)
        : token.startsWith("#")
          ? Number.parseInt(token.slice(1), 10)
          : null;
      if (code != null) {
        if (!Number.isInteger(code) || code < 0 || code > 0x10ffff) return entity;
        return String.fromCodePoint(code);
      }
      return NAMED_ENTITIES[token] ?? entity;
    });
    if (next === decoded) break;
    decoded = next;
  }
  return decoded
    .normalize("NFC")
    .replace(/[\uFE0E\uFE0F]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function normalize(value: string): string {
  return normalizeOutboundText(value);
}
