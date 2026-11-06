/** No recargar un hilo antes de este plazo, ni dos hilos más seguidos que esto. */
export const FALLBACK_RELOAD_MS = 15_000;

/** Cierra la pestaña si nadie mira la bandeja. */
export const WATCH_IDLE_MS = 5 * 60_000;

export const NAV_PACE_MS = 1_200;

/** Tope del respaldo sin socket. El WebSocket de la cuenta cubre el resto. */
export const MAX_FALLBACK_THREADS = 8;

/**
 * Latencia esperada con la bandeja abierta:
 * una pestaña por cuenta escucha el WebSocket, que trae todos los chats.
 * Ese mensaje se guarda al llegar y la pantalla lo ve en ≤2 s.
 * Si el socket no trae mensajes, se rota entre los hilos vigilados,
 * primero el que más gente mira, como mínimo cada 15 s por hilo
 * y nunca más de un hilo cada 15 s, con un tope de 8.
 * El barrido programado no se acelera.
 */

export type WatchedThread = { threadKey: string; watchers: number };

/** Más watchers primero. A igual número, la clave ordena el desempate. */
export function rankWatchedThreads(watches: Array<{ threadKey: string | null }>): WatchedThread[] {
  const counts = new Map<string, number>();
  for (const watch of watches) {
    if (!watch.threadKey) continue;
    counts.set(watch.threadKey, (counts.get(watch.threadKey) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([threadKey, watchers]) => ({ threadKey, watchers }))
    .sort((left, right) => right.watchers - left.watchers || left.threadKey.localeCompare(right.threadKey));
}

/**
 * La cuenta con más bandejas abiertas se queda la pestaña.
 * El perfil solo admite una cuenta a la vez; la otra espera.
 */
export function pickAccountWatch(
  watches: Array<{ creatorId: string; threadKey: string | null }>,
): { creatorId: string; threads: WatchedThread[]; watchers: number } | null {
  const byCreator = new Map<string, Array<{ threadKey: string | null }>>();
  for (const watch of watches) {
    const list = byCreator.get(watch.creatorId) ?? [];
    list.push(watch);
    byCreator.set(watch.creatorId, list);
  }
  let chosen: { creatorId: string; threads: WatchedThread[]; watchers: number } | null = null;
  for (const [creatorId, list] of byCreator) {
    const candidate = { creatorId, threads: rankWatchedThreads(list), watchers: list.length };
    if (
      !chosen
      || candidate.watchers > chosen.watchers
      || (candidate.watchers === chosen.watchers && candidate.creatorId.localeCompare(chosen.creatorId) < 0)
    ) {
      chosen = candidate;
    }
  }
  return chosen;
}

/**
 * Siguiente hilo a recargar si el socket no trae mensajes.
 * Respeta 15 s desde que se abrió la pestaña, 15 s por hilo y 15 s entre cualquier recarga.
 * Fuera del tope no entra.
 */
export function nextFallbackThread(
  threads: WatchedThread[],
  reloadedAt: ReadonlyMap<string, number>,
  openedAt: number | null,
  lastGlobalReloadAt: number | null,
  now: number,
  perThreadMs = FALLBACK_RELOAD_MS,
): string | null {
  if (lastGlobalReloadAt != null && now - lastGlobalReloadAt < perThreadMs) return null;
  const due = threads.slice(0, MAX_FALLBACK_THREADS).filter((thread) => {
    const last = reloadedAt.get(thread.threadKey);
    const since = last == null ? (openedAt == null ? 0 : now - openedAt) : now - last;
    return since >= perThreadMs;
  });
  due.sort((left, right) => {
    const leftAt = reloadedAt.get(left.threadKey) ?? openedAt ?? 0;
    const rightAt = reloadedAt.get(right.threadKey) ?? openedAt ?? 0;
    if (leftAt !== rightAt) return leftAt - rightAt;
    return right.watchers - left.watchers || left.threadKey.localeCompare(right.threadKey);
  });
  return due[0]?.threadKey ?? null;
}
export function planWatch(input: {
  watchers: number;
  wantedThread: string | null;
  pageThread: string | null;
  pageOpen: boolean;
  lastNavAt: number | null;
  lastUsefulAt: number | null;
  lastReloadAt: number | null;
  lastWatcherAt: number;
  now: number;
  blockedUntil: number | null;
  paceMs?: number;
  fallbackMs?: number;
  idleMs?: number;
}): "close" | "hold" | "open" | "navigate" | "reload" {
  const pace = input.paceMs ?? NAV_PACE_MS;
  const fallback = input.fallbackMs ?? FALLBACK_RELOAD_MS;
  const idle = input.idleMs ?? WATCH_IDLE_MS;
  if (input.blockedUntil != null && input.now < input.blockedUntil) {
    return input.pageOpen ? "close" : "hold";
  }
  if (input.watchers <= 0) {
    if (input.now - input.lastWatcherAt >= idle) return "close";
    return "hold";
  }
  if (!input.pageOpen) return "open";
  if (input.wantedThread !== input.pageThread) {
    if (input.lastNavAt == null || input.now - input.lastNavAt >= pace) return "navigate";
    return "hold";
  }
  const quiet = input.lastUsefulAt == null || input.now - input.lastUsefulAt >= fallback;
  const reloadDue = input.lastReloadAt == null || input.now - input.lastReloadAt >= fallback;
  const sinceNav = input.lastNavAt == null || input.now - input.lastNavAt >= fallback;
  if (quiet && reloadDue && sinceNav) return "reload";
  return "hold";
}
