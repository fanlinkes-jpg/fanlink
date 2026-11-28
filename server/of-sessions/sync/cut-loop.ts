import { dueForCut, lastCut, msUntilNextCut } from "../../../src/lib/dashboard-cuts.ts";
import type { ScheduleAccount } from "./schedule.ts";
import { signedReadsBlocked } from "./session-link.ts";

/**
 * Lecturas del Dashboard por cortes (00:00, 08:00 y 16:00 Europe/Madrid por defecto).
 * - Solo cuentas de la allowlist de lectura.
 * - Una cuenta cada vez, con un margen aleatorio entre cuentas: sin ráfagas.
 * - Una cuenta en pausa (429 u otro bloqueo) se salta; tras dos fallos seguidos espera más (backoff).
 * - Solo GET: abre las páginas normales de estadísticas y fans, y la lista de fans online.
 */
export type CutAccount = ScheduleAccount & { allowed: boolean; paused: boolean; lastOnlineAt?: string | null };

export type CutSkip = "not_allowed" | "blocked" | "paused" | "backoff" | "done";

export function cutSkipReason(account: CutAccount, now: Date, hours: readonly number[]): CutSkip | null {
  if (!account.allowed) return "not_allowed";
  if (signedReadsBlocked(account) || account.identityState === "mismatch" || account.status !== "active" || !account.hasStorageState) return "blocked";
  if (account.paused) return "paused";
  if (!dueForCut(account.lastAttemptAt, now, hours)) return "done";
  if (account.consecutiveFailures >= 2 && account.lastAttemptAt) {
    const wait = Math.min(2 ** (account.consecutiveFailures - 1), 16) * 5 * 60_000;
    if (now.getTime() - Date.parse(account.lastAttemptAt) < wait) return "backoff";
  }
  return null;
}

/** La cuenta que toca en este corte: la que lleva más tiempo sin leerse. */
export function pickCutAccount(accounts: readonly CutAccount[], now: Date, hours: readonly number[]): CutAccount | null {
  const due = accounts.filter((account) => cutSkipReason(account, now, hours) == null);
  due.sort((a, b) => (a.lastAttemptAt ? Date.parse(a.lastAttemptAt) : 0) - (b.lastAttemptAt ? Date.parse(b.lastAttemptAt) : 0));
  return due[0] ?? null;
}

/** Fans online entre cortes: solo si `onlineMin` > 0 (por defecto 0 = solo en los cortes). */
export function pickOnlineAccount(accounts: readonly CutAccount[], now: Date, onlineMin: number): CutAccount | null {
  if (onlineMin <= 0) return null;
  const due = accounts.filter((account) => {
    if (!account.allowed || account.paused || signedReadsBlocked(account) || account.status !== "active" || !account.hasStorageState) return false;
    if (!account.lastOnlineAt) return true;
    return now.getTime() - Date.parse(account.lastOnlineAt) >= onlineMin * 60_000;
  });
  return due[0] ?? null;
}

export function startCutLoop(deps: {
  hours: readonly number[];
  onlineMin: number;
  accounts: () => Promise<CutAccount[]>;
  sync: (account: CutAccount, cutAt: Date) => Promise<void>;
  online: (account: CutAccount) => Promise<void>;
  cutStarted?: (cutAt: Date) => Promise<void>;
  cutFinished?: (cutAt: Date, read: number) => Promise<void>;
  /**
   * Se pregunta una vez al arrancar. Si dice que sí (no hay ningún corte guardado), se lee cada cuenta
   * autorizada una vez aunque ya se hubiera intentado tras el último corte. Siempre de una en una, con margen.
   */
  firstCut?: () => Promise<boolean>;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  /** Margen entre cuentas. Por defecto 45–120 s. */
  marginMinMs?: number;
  marginMaxMs?: number;
  log?: (text: string) => void;
}): { stop: () => void } {
  let stopped = false;
  const now = deps.now ?? (() => new Date());
  const sleep = deps.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const random = deps.random ?? Math.random;
  const marginMin = deps.marginMinMs ?? 45_000;
  const marginMax = deps.marginMaxMs ?? 120_000;
  const log = deps.log ?? ((text: string) => console.info(text));
  void (async () => {
    let currentCut: number | null = null;
    let readThisCut = 0;
    await sleep(60_000);
    let forcing = false;
    try {
      forcing = (await deps.firstCut?.()) === true;
    } catch {
      forcing = false;
    }
    if (forcing) log("[fanlink:corte] no hay ningún corte guardado: lectura inicial, una cuenta cada vez");
    const forced = new Set<string>();
    while (!stopped) {
      try {
        const at = now();
        const cutAt = lastCut(at, deps.hours);
        const accounts = await deps.accounts();
        if (stopped) return;
        // En la lectura inicial cuenta como «pendiente» toda cuenta que aún no se ha leído en este arranque.
        const view = forcing
          ? accounts.map((account) => (forced.has(account.accountId) ? account : { ...account, lastAttemptAt: null, consecutiveFailures: 0 }))
          : accounts;
        const pick = pickCutAccount(view, at, deps.hours);
        if (pick) {
          if (currentCut !== cutAt.getTime()) {
            currentCut = cutAt.getTime();
            readThisCut = 0;
            await deps.cutStarted?.(cutAt);
            log(`[fanlink:corte] empieza corte=${cutAt.toISOString()}`);
          }
          await deps.sync(pick, cutAt);
          forced.add(pick.accountId);
          readThisCut += 1;
          await sleep(Math.round(marginMin + Math.min(1, Math.max(0, random())) * Math.max(0, marginMax - marginMin)));
          continue;
        }
        if (currentCut === cutAt.getTime()) {
          await deps.cutFinished?.(cutAt, readThisCut);
          log(`[fanlink:corte] terminado corte=${cutAt.toISOString()} cuentas=${readThisCut}`);
          currentCut = null;
        }
        if (forcing && !pick) forcing = false;
        const online = pickOnlineAccount(accounts, at, deps.onlineMin);
        if (online) {
          await deps.online(online);
          await sleep(Math.round(marginMin + random() * Math.max(0, marginMax - marginMin)));
          continue;
        }
        await sleep(Math.min(60_000, msUntilNextCut(at, deps.hours)));
      } catch (error) {
        const message = error instanceof Error ? error.message : "error";
        log(`[fanlink:corte] reintenta: ${message.replace(/cookie|authorization|bearer\s+\S+|sess=[^\s;]+/gi, "[omitido]").slice(0, 160)}`);
        await sleep(30_000);
      }
    }
  })();
  return {
    stop() {
      stopped = true;
    },
  };
}
