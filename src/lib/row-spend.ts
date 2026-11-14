/** Hilo, luego ficha, luego lo pedido aparte. Un 0 real no se salta. */
export function rowSpendCents(thread: number | null, card: number | null, fetched: number | null): number | null {
  return thread ?? card ?? fetched ?? null;
}

export function spendLogLine(input: {
  creatorId: string;
  thread: number;
  card: number;
  subscribers: number;
  users: number;
  stillNull: number;
}): string {
  return `[fanlink:spend] creator=${input.creatorId} thread=${input.thread} card=${input.card} subscribers=${input.subscribers} users=${input.users} still null=${input.stillNull}`;
}
