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
    const sales = input.sales.filter((sale) => covers(spans, sale.creatorId, sale.at));
    const messages = input.messages.filter((message) => covers(spans, message.creatorId, message.at));
    const sent = messages.filter((message) => !message.fromFan && message.priceCents != null);
    const replies = firstReplies(messages);
    return {
      userId,
      grossCents: input.sales.length === 0 && sales.length === 0 ? null : sales.reduce((sum, sale) => sum + sale.grossCents, 0),
      ppvSent: messages.length === 0 && sent.length === 0 ? null : sent.length,
      ppvBought: messages.length === 0 && sent.length === 0 ? null : sent.filter((message) => message.purchased === true).length,
      firstReplyMinutes: replies.length === 0 ? null : Math.round(replies.reduce((sum, value) => sum + value, 0) / replies.length),
      threads: messages.length === 0 ? null : new Set(messages.map((message) => `${message.creatorId}:${message.threadKey}`)).size,
    };
  });
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
    for (let index = 0; index < ordered.length; index += 1) {
      const message = ordered[index];
      if (!message?.fromFan) continue;
      const reply = ordered.slice(index + 1).find((item) => !item.fromFan);
      if (!reply) continue;
      const delta = (Date.parse(reply.at) - Date.parse(message.at)) / 60_000;
      if (delta >= 0) minutes.push(delta);
    }
  }
  return minutes;
}
