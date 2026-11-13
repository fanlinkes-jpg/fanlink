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

type LiveStopper = (accountId: string) => Promise<void>;

function globalStopper(): { current: LiveStopper | null } {
  const holder = globalThis as typeof globalThis & { __fanlinkLiveStopper?: { current: LiveStopper | null } };
  holder.__fanlinkLiveStopper ??= { current: null };
  return holder.__fanlinkLiveStopper;
}

/** La sala del directo se apunta aquí. Así el login no depende de importar room.ts al cargar. */
export function registerLiveStopper(stop: LiveStopper | null): void {
  globalStopper().current = stop;
}

/** Cierra la vista en directo de la cuenta y suelta su perfil. Conectar lo llama antes de abrir Chromium. */
export async function stopLiveForAccount(accountId: string): Promise<void> {
  await globalStopper().current?.(accountId).catch(() => undefined);
}
