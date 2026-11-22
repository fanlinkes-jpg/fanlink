import type { WorkspaceSlice } from "./access-policy.ts";

const FIELDS = [
  "agency",
  "creators",
  "fans",
  "messages",
  "vault",
  "scripts",
  "lists",
  "campaigns",
  "employees",
  "links",
  "automations",
  "history",
  "stopWords",
  "copilot",
  "translate",
  "adaptPrices",
  "notifyShifts",
  "dashboardConfig",
] as const satisfies readonly (keyof WorkspaceSlice)[];

export type WorkspaceSaveOutcome =
  | { ok: true; version: number }
  | { ok: false; reason: "conflict"; version: number; state: WorkspaceSlice | null; updatedBy: string | null }
  | { ok: false; reason: "forbidden"; message: string };

export function sameWorkspaceValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

/**
 * Cada campo se queda con quien lo cambió. Si los dos lo cambiaron,
 * la copia de esta pestaña gana cuando el conflicto es del mismo usuario.
 */
export function mergeWorkspaceFields(
  base: WorkspaceSlice,
  local: WorkspaceSlice,
  remote: WorkspaceSlice,
  sameUser: boolean,
): WorkspaceSlice {
  const merged = { ...remote };
  const bag = merged as Record<keyof WorkspaceSlice, unknown>;
  for (const key of FIELDS) {
    const localChanged = !sameWorkspaceValue(base[key], local[key]);
    const remoteChanged = !sameWorkspaceValue(base[key], remote[key]);
    bag[key] = localChanged && (!remoteChanged || sameUser) ? local[key] : remote[key];
  }
  return merged;
}

/** La misma persona, en esta pestaña o en otra, no ve el aviso de conflicto. */
export function conflictNotice(updatedBy: string | null, userId: string | null): string | null {
  if (userId && updatedBy === userId) return null;
  return "Otra sesión guardó antes. Se muestra la copia del servidor.";
}

export function createWorkspaceSaver(deps: {
  save: (input: { state: WorkspaceSlice; expectedVersion: number }) => Promise<WorkspaceSaveOutcome>;
  userId: () => string | null;
  apply: (state: WorkspaceSlice, version: number, notice: string | null) => void;
  notice: (message: string | null) => void;
  forbid: (message: string) => void;
}) {
  let known = 0;
  let base: WorkspaceSlice | null = null;
  let flight = false;
  let applying = false;
  let pending: WorkspaceSlice | null = null;
  let chain: Promise<void> = Promise.resolve();

  async function saveOne(state: WorkspaceSlice): Promise<void> {
    const expected = known;
    const savedBase = base ?? state;
    const saved = await deps.save({ state, expectedVersion: expected });
    if (saved.ok) {
      known = saved.version;
      base = state;
      return;
    }
    if (saved.reason === "forbidden") {
      deps.forbid(saved.message);
      return;
    }
    if (!saved.state) return;
    const userId = deps.userId();
    const same = Boolean(userId && saved.updatedBy === userId);
    const latest = pending;
    const merged = mergeWorkspaceFields(savedBase, latest ?? state, saved.state, same);
    known = saved.version;
    base = saved.state;
    const notice = conflictNotice(saved.updatedBy, userId);
    if (latest) {
      pending = latest;
      if (notice) deps.notice(notice);
      return;
    }
    if (!sameWorkspaceValue(merged, saved.state)) pending = merged;
    if (pending === merged || notice) {
      applying = true;
      deps.apply(pending === merged ? merged : saved.state, saved.version, notice);
      applying = false;
    }
  }

  async function run(state: WorkspaceSlice): Promise<void> {
    try {
      await saveOne(state);
      while (pending) {
        const next = pending;
        pending = null;
        await saveOne(next);
      }
    } finally {
      flight = false;
      if (pending) {
        const next = pending;
        pending = null;
        flight = true;
        chain = chain.then(() => run(next)).catch(() => {
          flight = false;
        });
      }
    }
  }

  return {
    knownVersion(): number {
      return known;
    },
    reset(version: number, state: WorkspaceSlice | null) {
      known = version;
      base = state;
    },
    push(state: WorkspaceSlice) {
      if (applying) return;
      if (flight) {
        pending = state;
        return;
      }
      flight = true;
      chain = chain.then(() => run(state)).catch(() => {
        flight = false;
      });
    },
    idle(): Promise<void> {
      return chain;
    },
  };
}
