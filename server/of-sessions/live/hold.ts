const holds = globalHolds();

function globalHolds(): Map<string, number> {
  const holder = globalThis as typeof globalThis & { __fanlinkLiveHolds?: Map<string, number> };
  holder.__fanlinkLiveHolds ??= new Map();
  return holder.__fanlinkLiveHolds;
}

/** La página real tiene el navegador de esa cuenta. El lector de fondo no abre otro. */
export function noteLiveHold(accountId: string): void {
  holds.set(accountId, (holds.get(accountId) ?? 0) + 1);
}

export function releaseLiveHold(accountId: string): void {
  const next = (holds.get(accountId) ?? 0) - 1;
  if (next > 0) holds.set(accountId, next);
  else holds.delete(accountId);
}

export function liveHoldsAccount(accountId: string): boolean {
  return (holds.get(accountId) ?? 0) > 0;
}
