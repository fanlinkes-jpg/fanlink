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

/** Una lectura firmada a la vez por cuenta. La siguiente espera a la anterior. */
export function withAccountChatReader<T>(accountId: string, run: () => Promise<T>): Promise<T> {
  const prev = tails.get(accountId) ?? Promise.resolve();
  const next = prev.then(run, run);
  tails.set(accountId, next.then(() => undefined, () => undefined));
  return next;
}

/**
 * Cuenta las peticiones de un minuto con un solo lector y 300 ms entre medias.
 * La lista completa sale al empezar y no se repite hasta los 2 min.
 * Los hilos abiertos piden solo su primera página, nunca más de una vez cada 2 s,
 * y el hueco de 300 ms alarga el barrido si hay muchos.
 */
export function simulateChatReads(input: { openThreads: number; fullPages: number; durationMs: number }): {
  requests: number;
  openSweeps: number;
  headPages: number;
  fullRuns: number;
} {
  let time = 0;
  let nextOpen = 0;
  let nextHead = LIST_HEAD_MS;
  let nextFull = 0;
  let requests = 0;
  let openSweeps = 0;
  let headPages = 0;
  let fullRuns = 0;
  const end = input.durationMs;
  while (time < end) {
    if (time >= nextFull) {
      const pages = Math.max(1, input.fullPages);
      requests += pages;
      fullRuns += 1;
      const start = time;
      time += Math.max(0, pages - 1) * REQUEST_GAP_MS;
      nextFull = start + FULL_LIST_MS;
      nextHead = start + LIST_HEAD_MS;
      continue;
    }
    if (time >= nextHead) {
      requests += 1;
      headPages += 1;
      nextHead = time + LIST_HEAD_MS;
      time += REQUEST_GAP_MS;
      continue;
    }
    if (time >= nextOpen) {
      const count = Math.max(0, input.openThreads);
      requests += count;
      openSweeps += 1;
      const start = time;
      time += Math.max(0, count - 1) * REQUEST_GAP_MS;
      nextOpen = Math.max(time, start + OPEN_PULL_MS);
      continue;
    }
    time = Math.min(nextFull, nextHead, nextOpen);
  }
  return { requests, openSweeps, headPages, fullRuns };
}
