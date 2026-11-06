/** No recargar el hilo abierto antes de este plazo. */
export const FALLBACK_RELOAD_MS = 15_000;

/** Cierra la pestaña si nadie mira la bandeja. */
export const WATCH_IDLE_MS = 5 * 60_000;

export const NAV_PACE_MS = 1_200;

/**
 * Latencia esperada con la bandeja abierta:
 * el WebSocket o el JSON que la propia página pide se guarda al llegar;
 * la pantalla lo ve en ≤2 s (el stream). Si no hay socket, se recarga
 * solo ese hilo cada 15 s como mínimo. El barrido de la bandeja no se acelera.
 */
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
