export type AssignmentSpan = {
  creatorId: string;
  userId: string;
  startedAt: string;
  endedAt: string | null;
};

export type TeamSale = {
  creatorId: string;
  at: string;
  grossCents: number;
  kind: "tip" | "ppv";
};

export type TeamMessage = {
  creatorId: string;
  threadKey: string;
  at: string;
  fromFan: boolean;
  priceCents: number | null;
  purchased: boolean | null;
};

export type ChatterReport = {
  userId: string;
  grossCents: number | null;
  ppvSent: number | null;
  ppvBought: number | null;
  firstReplyMinutes: number | null;
  threads: number | null;
};

export function chatterReports(input: {
  assignments: AssignmentSpan[];
  sales: TeamSale[];
  messages: TeamMessage[];
}): ChatterReport[] {
  const users = [...new Set(input.assignments.map((row) => row.userId))];
  return users.map((userId) => {
    const spans = input.assignments.filter((row) => row.userId === userId);
    const sales = input.sales.filter((sale) => soleUser(input.assignments, sale.creatorId, sale.at) === userId);
    const messages = input.messages.filter((message) => soleUser(input.assignments, message.creatorId, message.at) === userId);
    const sent = messages.filter((message) => !message.fromFan && message.priceCents != null && message.priceCents > 0);
    const replies = firstReplies(messages);
    return {
      userId,
      grossCents: sales.length === 0 ? null : sales.reduce((sum, sale) => sum + sale.grossCents, 0),
      ppvSent: messages.length === 0 ? null : sent.length,
      ppvBought: messages.length === 0 ? null : sent.filter((message) => message.purchased === true).length,
      firstReplyMinutes: replies.length === 0 ? null : Math.round(replies.reduce((sum, value) => sum + value, 0) / replies.length),
      threads: messages.length === 0 ? null : new Set(messages.map((message) => `${message.creatorId}:${message.threadKey}`)).size,
    };
  });
}

function soleUser(spans: AssignmentSpan[], creatorId: string, at: string): string | null {
  const users = spans.filter((span) => covers([span], creatorId, at)).map((span) => span.userId);
  const unique = [...new Set(users)];
  return unique.length === 1 ? unique[0] ?? null : null;
}

function covers(spans: AssignmentSpan[], creatorId: string, at: string): boolean {
  const time = Date.parse(at);
  return spans.some((span) => {
    if (span.creatorId !== creatorId) return false;
    const start = Date.parse(span.startedAt);
    const end = span.endedAt ? Date.parse(span.endedAt) : Number.POSITIVE_INFINITY;
    return time >= start && time < end;
  });
}

function firstReplies(messages: TeamMessage[]): number[] {
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
      const delta = (Date.parse(reply.at) - Date.parse(start.at)) / 60_000;
      if (delta >= 0) minutes.push(delta);
    }
  }
  return minutes;
}
