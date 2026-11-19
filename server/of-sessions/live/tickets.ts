import type { LiveSection } from "./sections.ts";

export type LiveTicket = {
  userId: string;
  accountId: string;
  creatorId: string;
  threadKey: string;
  fanKey: string | null;
  accountUserId: string | null;
  section: LiveSection;
};

const tickets = globalTickets();

function globalTickets(): Map<string, LiveTicket & { expires: number }> {
  const holder = globalThis as typeof globalThis & {
    __fanlinkLiveTickets?: Map<string, LiveTicket & { expires: number }>;
  };
  holder.__fanlinkLiveTickets ??= new Map();
  return holder.__fanlinkLiveTickets;
}

export function issueLiveTicket(ticket: Omit<LiveTicket, "section"> & { section?: LiveSection }, now = Date.now()): string {
  const id = crypto.randomUUID();
  tickets.set(id, { ...ticket, section: ticket.section ?? "chat", expires: now + 30_000 });
  return id;
}

export function takeLiveTicket(id: string, now = Date.now()): LiveTicket | null {
  const ticket = tickets.get(id);
  tickets.delete(id);
  if (!ticket || ticket.expires <= now) return null;
  const { expires: _expires, ...rest } = ticket;
  return rest;
}
