import type { IdentityState, SessionStatus } from "../types.ts";

export type SkipReason = "mismatch" | "expired" | "pending" | "in_progress" | "backoff" | "not_due";

export type ScheduleAccount = {
  accountId: string;
  creatorId: string;
  status: SessionStatus;
  identityState: IdentityState;
  hasStorageState: boolean;
  consecutiveFailures: number;
  lastAttemptAt: string | null;
};

export type SchedulePick = {
  accountId: string | null;
  creatorId: string | null;
  skipped: Array<{ accountId: string; reason: SkipReason }>;
  waitMs: number;
};

const MIN_INTERVAL_MIN = 5;
const MAX_INTERVAL_MIN = 24 * 60;
const DEFAULT_INTERVAL_MIN = 30;
const CHECK_CAP_MS = 60_000;

export function clampIntervalMin(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_INTERVAL_MIN;
  return Math.min(MAX_INTERVAL_MIN, Math.max(MIN_INTERVAL_MIN, Math.round(value)));
}

export function intervalMinFromEnv(raw: string | undefined): number {
  if (!raw || !raw.trim()) return DEFAULT_INTERVAL_MIN;
  return clampIntervalMin(Number(raw));
}

/** Tras dos fallos seguidos la espera crece: 2x, 4x, 8x… y se queda en 16x. */
export function backoffMs(intervalMs: number, consecutiveFailures: number): number {
  if (consecutiveFailures < 2) return intervalMs;
  const factor = Math.min(2 ** (consecutiveFailures - 1), 16);
  return intervalMs * factor;
}

export function marginMs(random: () => number, minMs: number, maxMs: number): number {
  const span = Math.max(0, maxMs - minMs);
  const roll = Math.min(1, Math.max(0, random()));
  return Math.round(minMs + roll * span);
}

/**
 * Elige como mucho una cuenta. Si ya hay una lectura en curso, no elige otra.
 * No coincide, sesión caducada o pendiente no entran. No verificada sí entra.
 */
export function selectSyncAccount(input: {
  now: Date;
  intervalMs: number;
  accounts: ScheduleAccount[];
  inProgressIds: ReadonlySet<string>;
}): SchedulePick {
  const skipped: Array<{ accountId: string; reason: SkipReason }> = [];
  if (input.inProgressIds.size > 0) {
    for (const account of input.accounts) {
      if (input.inProgressIds.has(account.accountId)) {
        skipped.push({ accountId: account.accountId, reason: "in_progress" });
      }
    }
    return { accountId: null, creatorId: null, skipped, waitMs: 1_000 };
  }

  const due: ScheduleAccount[] = [];
  let soonest = CHECK_CAP_MS;
  for (const account of input.accounts) {
    const reason = skipReason(account, input.now, input.intervalMs);
    if (reason === "not_due" || reason === "backoff") {
      soonest = Math.min(soonest, remainingMs(account, input.now, input.intervalMs));
      skipped.push({ accountId: account.accountId, reason });
      continue;
    }
    if (reason) {
      skipped.push({ accountId: account.accountId, reason });
      continue;
    }
    due.push(account);
  }
  due.sort((left, right) => attemptTime(left) - attemptTime(right));
  const picked = due[0];
  if (!picked) {
    return { accountId: null, creatorId: null, skipped, waitMs: Math.max(1_000, soonest) };
  }
  return { accountId: picked.accountId, creatorId: picked.creatorId, skipped, waitMs: 0 };
}

export async function runSyncOnce(input: {
  now: Date;
  intervalMs: number;
  accounts: ScheduleAccount[];
  inProgressIds: Set<string>;
  sync: (accountId: string, creatorId: string) => Promise<void>;
}): Promise<{ ran: string | null }> {
  const pick = selectSyncAccount({
    now: input.now,
    intervalMs: input.intervalMs,
    accounts: input.accounts,
    inProgressIds: input.inProgressIds,
  });
  if (!pick.accountId || !pick.creatorId) return { ran: null };
  input.inProgressIds.add(pick.accountId);
  try {
    await input.sync(pick.accountId, pick.creatorId);
  } finally {
    input.inProgressIds.delete(pick.accountId);
  }
  return { ran: pick.accountId };
}

function skipReason(account: ScheduleAccount, now: Date, intervalMs: number): SkipReason | null {
  if (account.identityState === "mismatch") return "mismatch";
  if (account.status === "expired") return "expired";
  if (account.status !== "active" || !account.hasStorageState) return "pending";
  if (!account.lastAttemptAt) return null;
  const wait = backoffMs(intervalMs, account.consecutiveFailures);
  const elapsed = now.getTime() - Date.parse(account.lastAttemptAt);
  if (elapsed >= wait) return null;
  return account.consecutiveFailures >= 2 ? "backoff" : "not_due";
}

function remainingMs(account: ScheduleAccount, now: Date, intervalMs: number): number {
  if (!account.lastAttemptAt) return 0;
  const wait = backoffMs(intervalMs, account.consecutiveFailures);
  const left = Date.parse(account.lastAttemptAt) + wait - now.getTime();
  return Math.min(CHECK_CAP_MS, Math.max(1_000, left));
}

export function startSyncLoop(deps: {
  intervalMin: () => Promise<number>;
  accounts: () => Promise<ScheduleAccount[]>;
  inProgressIds: () => ReadonlySet<string>;
  sync: (accountId: string, creatorId: string) => Promise<void>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
  random?: () => number;
  marginMinMs?: number;
  marginMaxMs?: number;
}): { stop: () => void } {
  let stopped = false;
  const sleep = deps.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = deps.now ?? (() => new Date());
  const random = deps.random ?? Math.random;
  const marginMinMs = deps.marginMinMs ?? 15_000;
  const marginMaxMs = deps.marginMaxMs ?? 90_000;
  void (async () => {
    while (!stopped) {
      try {
        const intervalMs = (await deps.intervalMin()) * 60_000;
        const accounts = await deps.accounts();
        if (stopped) return;
        const inProgressIds = deps.inProgressIds();
        const pick = selectSyncAccount({
          now: now(),
          intervalMs,
          accounts,
          inProgressIds,
        });
        if (stopped) return;
        if (!pick.accountId || !pick.creatorId) {
          await sleep(pick.waitMs);
          continue;
        }
        await deps.sync(pick.accountId, pick.creatorId);
        if (stopped) return;
        await sleep(marginMs(random, marginMinMs, marginMaxMs));
      } catch (error) {
        console.info(`[fanlink:lectura] el planificador reintenta: ${redactLog(error)}`);
        await sleep(5_000);
      }
    }
  })();
  return {
    stop() {
      stopped = true;
    },
  };
}

function redactLog(error: unknown): string {
  const message = error instanceof Error ? error.message : "error";
  return message.replace(/cookie|set-cookie|authorization|bearer\s+\S+|sess=[^\s;]+/gi, "[omitido]").slice(0, 180);
}

function attemptTime(account: ScheduleAccount): number {
  if (!account.lastAttemptAt) return 0;
  const parsed = Date.parse(account.lastAttemptAt);
  return Number.isNaN(parsed) ? 0 : parsed;
}
