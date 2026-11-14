/** Primera página de cada hilo abierto. */
export const OPEN_PULL_MS = 2_000;
/** Primera página de la lista. */
export const LIST_HEAD_MS = 15_000;
/** Lista completa, con el tope de páginas. */
export const FULL_LIST_MS = 120_000;
/** Mínimo entre dos peticiones de la misma cuenta. */
export const REQUEST_GAP_MS = 300;

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
  const prev = lastRequestAt.get(accountId);
  const current = now();
  if (prev != null) {
    const wait = gapMs - (current - prev);
    if (wait > 0) await sleep(wait);
  }
  lastRequestAt.set(accountId, now());
}

export function clearAccountChatPace(): void {
  tails.clear();
  paces.clear();
  lastRequestAt.clear();
}

/** Una llamada firmada a la vez por cuenta. La lista y marcar leído pasan por aquí. */
export function withAccountApi<T>(accountId: string, run: () => Promise<T>): Promise<T> {
  return withAccountChatReader(accountId, run);
}

/** Una lectura firmada a la vez por cuenta. La siguiente espera a la anterior. */
export function withAccountChatReader<T>(accountId: string, run: () => Promise<T>): Promise<T> {
  const prev = tails.get(accountId) ?? Promise.resolve();
  const next = prev.then(run, run);
  tails.set(accountId, next.then(() => undefined, () => undefined));
  return next;
}
