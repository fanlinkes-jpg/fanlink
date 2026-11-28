/** Primera página de cada hilo abierto. */
export const OPEN_PULL_MS = 2_000;
/** Primera página de la lista. */
export const LIST_HEAD_MS = 15_000;
/** Lista completa, con el tope de páginas. */
export const FULL_LIST_MS = 120_000;
/** Mínimo entre dos peticiones de la misma cuenta. */
/** Espacio entre dos GET de la misma cuenta: bóveda, avisos e histórico. */
export const REQUEST_GAP_MS = 1_500;
/**
 * Primera página de notificaciones. 45 s está entre 30 y 60:
 * no se pide más de una vez por ese tramo.
 */
export const NOTIFICATION_HEAD_MS = 45_000;

export type NotificationPace = { headAt: number };

export function planNotificationPull(mark: NotificationPace | undefined, now: number): { head: boolean; next: NotificationPace } {
  const prev = mark ?? { headAt: 0 };
  const head = prev.headAt === 0 || now - prev.headAt >= NOTIFICATION_HEAD_MS;
  return { head, next: { headAt: head ? now : prev.headAt } };
}

export type ChatPace = { openAt: number; headAt: number; fullAt: number };

export type ChatPlan = {
  open: boolean;
  list: "full" | "head" | "none";
  next: ChatPace;
};

export function planChatPull(mark: ChatPace | undefined, now: number, part: "all" | "list" | "open"): ChatPlan {
  const prev = mark ?? { openAt: 0, headAt: 0, fullAt: 0 };
  const full = part !== "open" && (prev.fullAt === 0 || now - prev.fullAt >= FULL_LIST_MS);
  const head = part !== "open" && !full && (prev.headAt === 0 || now - prev.headAt >= LIST_HEAD_MS);
  const open = part !== "list" && (prev.openAt === 0 || now - prev.openAt >= OPEN_PULL_MS);
  return {
    open,
    list: full ? "full" : head ? "head" : "none",
    next: {
      openAt: open ? now : prev.openAt,
      headAt: full || head ? now : prev.headAt,
      fullAt: full ? now : prev.fullAt,
    },
  };
}

const tails = new Map<string, Promise<unknown>>();
const inflight = new Map<string, number>();
const paces = new Map<string, ChatPace>();
const lastRequestAt = new Map<string, number>();

export function chatPaceOf(accountId: string): ChatPace | undefined {
  return paces.get(accountId);
}

export function rememberChatPace(accountId: string, pace: ChatPace): void {
  paces.set(accountId, pace);
}

/** Separa las peticiones de una cuenta aunque vengan de llamadas distintas. */
export async function awaitAccountGap(accountId: string, now: () => number, sleep: (ms: number) => Promise<void>, gapMs = REQUEST_GAP_MS): Promise<void> {
  const gap = Math.max(gapMs, REQUEST_GAP_MS);
  const wall = now();
  const prev = lastRequestAt.get(accountId);
  const logicalNow = prev == null ? wall : Math.max(wall, prev);
  const earliest = prev == null ? wall : prev + gap;
  const slot = Math.max(logicalNow, earliest);
  lastRequestAt.set(accountId, slot);
  const wait = slot - logicalNow;
  if (wait > 0) await sleep(wait);
}

export function clearAccountChatPace(): void {
  tails.clear();
  inflight.clear();
  paces.clear();
  lastRequestAt.clear();
}

/** La lectura en vivo ya ocupa la cuenta. El histórico no se encola delante. */
export function accountApiBusy(accountId: string): boolean {
  return (inflight.get(accountId) ?? 0) > 0;
}

/** Una llamada firmada a la vez por cuenta. La lista y marcar leído pasan por aquí. */
export function withAccountApi<T>(accountId: string, run: () => Promise<T>): Promise<T> {
  return withAccountChatReader(accountId, run);
}

/** Una lectura firmada a la vez por cuenta. La siguiente espera a la anterior. */
export function withAccountChatReader<T>(accountId: string, run: () => Promise<T>): Promise<T> {
  const prev = tails.get(accountId) ?? Promise.resolve();
  const next = prev.then(start, start);
  tails.set(accountId, next.then(() => undefined, () => undefined));
  return next;

  function start(): Promise<T> {
    inflight.set(accountId, (inflight.get(accountId) ?? 0) + 1);
    return run().finally(() => {
      const left = (inflight.get(accountId) ?? 1) - 1;
      if (left <= 0) inflight.delete(accountId);
      else inflight.set(accountId, left);
    });
  }
}
