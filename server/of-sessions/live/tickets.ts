export type LiveTicket = {
  userId: string;
  accountId: string;
  creatorId: string;
  threadKey: string;
  fanKey: string | null;
  accountUserId: string | null;
};

const tickets = new Map<string, LiveTicket & { expires: number }>();

export function issueLiveTicket(ticket: LiveTicket, now = Date.now()): string {
  const id = crypto.randomUUID();
  tickets.set(id, { ...ticket, expires: now + 30_000 });
  return id;
}

export function takeLiveTicket(id: string, now = Date.now()): LiveTicket | null {
  const ticket = tickets.get(id);
  tickets.delete(id);
  if (!ticket || ticket.expires <= now) return null;
  const { expires: _expires, ...rest } = ticket;
  return rest;
}
