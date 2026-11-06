export type OutboundDraft = {
  id: string;
  authorId: string;
  body: string;
  priceCents: number | null;
  createdAt: string;
  threadKey: string | null;
  fanKey: string | null;
  ofMessageKey: string | null;
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
const TIE_MS = 60_000;

/** Casa un mensaje leído de OnlyFans con el borrador del chatter que lo escribió en el CRM. */
export function matchOutboundAuthor(message: MatchableMessage, drafts: OutboundDraft[]): { draftId: string; authorId: string } | null {
  const byId = drafts.find((draft) => draft.ofMessageKey != null && draft.ofMessageKey === message.messageKey);
  if (byId) return { draftId: byId.id, authorId: byId.authorId };
  const text = normalize(message.body);
  if (!text) return null;
  const ranked = drafts.flatMap((draft) => {
    if (normalize(draft.body) !== text) return [];
    if (draft.priceCents != null && message.priceCents != null && draft.priceCents !== message.priceCents) return [];
    const delta = Math.abs(Date.parse(message.sentAt) - Date.parse(draft.createdAt));
    if (!Number.isFinite(delta) || delta > WINDOW_MS) return [];
    return [{ draft, delta }];
  }).sort((left, right) => left.delta - right.delta);
  const best = ranked[0];
  if (!best) return null;
  const next = ranked[1];
  if (next && next.draft.authorId !== best.draft.authorId && next.delta - best.delta < TIE_MS) return null;
  return { draftId: best.draft.id, authorId: best.draft.authorId };
}

function normalize(value: string): string {
  return value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
}
