export type TeamSale = {
  creatorId: string;
  fanKey: string | null;
  at: string;
  grossCents: number;
  kind: "tip" | "ppv";
};

export type TeamMessage = {
  creatorId: string;
  threadKey: string;
  fanKey: string | null;
  at: string;
  fromFan: boolean;
  priceCents: number | null;
  purchased: boolean | null;
  /** Autor en el CRM. Null si OnlyFans no dice quién escribió. */
  authorId: string | null;
};

export type ChatterReport = {
  userId: string;
  grossCents: number | null;
  ppvSent: number | null;
  ppvBought: number | null;
  firstReplyMinutes: number | null;
  threads: number | null;
};

/**
 * Cada venta es de quien escribió el mensaje. Si dos autores escribieron
 * a ese fan antes de la venta, no se atribuye a ninguno.
 */
export function chatterReports(input: { messages: TeamMessage[]; sales: TeamSale[] }): ChatterReport[] {
  const users = [...new Set(input.messages.flatMap((message) => (message.authorId ? [message.authorId] : [])))];
  return users.map((userId) => {
    const mine = input.messages.filter((message) => message.authorId === userId);
    const sales = input.sales.filter((sale) => soleAuthor(sale, input.messages) === userId);
    const sent = mine.filter((message) => !message.fromFan && message.priceCents != null && message.priceCents > 0);
    const replies = firstReplies(input.messages, userId);
    return {
      userId,
      grossCents: sales.length === 0 ? null : sales.reduce((sum, sale) => sum + sale.grossCents, 0),
      ppvSent: mine.length === 0 ? null : sent.length,
      ppvBought: mine.length === 0 ? null : sent.filter((message) => message.purchased === true).length,
      firstReplyMinutes: replies.length === 0 ? null : Math.round(replies.reduce((sum, value) => sum + value, 0) / replies.length),
      threads: mine.length === 0 ? null : new Set(mine.map((message) => `${message.creatorId}:${message.threadKey}`)).size,
    };
  });
}

function soleAuthor(sale: TeamSale, messages: TeamMessage[]): string | null {
  const authors = messages.flatMap((message) => {
    if (message.fromFan || !message.authorId) return [];
    if (message.creatorId !== sale.creatorId) return [];
    if (sale.fanKey && message.fanKey && message.fanKey !== sale.fanKey) return [];
    if (message.at > sale.at) return [];
    return [message.authorId];
  });
  const unique = [...new Set(authors)];
  return unique.length === 1 ? unique[0] ?? null : null;
}

function firstReplies(messages: TeamMessage[], userId: string): number[] {
  const byThread = new Map<string, TeamMessage[]>();
  for (const message of messages) {
    const key = `${message.creatorId}:${message.threadKey}`;
    const list = byThread.get(key) ?? [];
    list.push(message);
    byThread.set(key, list);
  }
  const minutes: number[] = [];
  for (const list of byThread.values()) {
    const ordered = [...list].sort((left, right) => left.at.localeCompare(right.at));
    let index = 0;
    while (index < ordered.length) {
      const message = ordered[index];
      if (!message?.fromFan) {
        index += 1;
        continue;
      }
      const start = message;
      while (index < ordered.length && ordered[index]?.fromFan) index += 1;
      const reply = ordered[index];
      if (!reply || reply.fromFan) continue;
      if (reply.authorId !== userId) continue;
      const delta = (Date.parse(reply.at) - Date.parse(start.at)) / 60_000;
      if (delta >= 0) minutes.push(delta);
    }
  }
  return minutes;
}
