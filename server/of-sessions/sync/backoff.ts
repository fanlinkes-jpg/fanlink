const BASE_MS = 15_000;
const CAP_MS = 30 * 60_000;

/** Espera exponencial con jitter. El azar solo mueve el tramo, no el orden. */
export function backoffDelayMs(attempt: number, random: () => number = Math.random): number {
  const step = Math.min(Math.max(0, Math.floor(attempt)), 6);
  const base = Math.min(BASE_MS * 2 ** step, CAP_MS);
  const roll = Math.min(1, Math.max(0, random()));
  const jitter = 0.75 + roll * 0.5;
  return Math.round(base * jitter);
}

export function blockKind(status: number, text = ""): "403" | "429" | "captcha" | "login" | null {
  if (status === 403) return "403";
  if (status === 429) return "429";
  if (/captcha|challenge|cloudflare/i.test(text)) return "captcha";
  if (/login|sesión|sesion|caducad/i.test(text)) return "login";
  return null;
}

type Pause = { until: number; reason: string; attempt: number };

const pauses = new Map<string, Pause>();

export function noteAccountBlock(accountId: string, reason: string, now = Date.now(), random: () => number = Math.random): number {
  const prev = pauses.get(accountId);
  const attempt = prev && prev.until > now ? prev.attempt + 1 : 0;
  const delay = backoffDelayMs(attempt, random);
  pauses.set(accountId, { until: now + delay, reason, attempt });
  return delay;
}

/** Un 400 es la firma. Un 429 u otra pausa dice la causa y los segundos. */
export function pauseWaitReason(pause: { reason: string; until: number }, now: number): { reason: string; signatureRejected: boolean } {
  if (pause.reason === "400") {
    return { reason: "OnlyFans rechazó la firma", signatureRejected: true };
  }
  const seconds = Math.max(1, Math.ceil((pause.until - now) / 1000));
  return { reason: `pausa por ${pause.reason} (espera ${seconds} s)`, signatureRejected: false };
}

export function accountPause(accountId: string, now = Date.now()): Pause | null {
  const row = pauses.get(accountId);
  if (!row || row.until <= now) return null;
  return row;
}

export function listAccountPauses(now = Date.now()): Array<{ accountId: string; reason: string }> {
  return [...pauses.entries()]
    .filter(([, row]) => row.until > now)
    .map(([accountId, row]) => ({ accountId, reason: row.reason }));
}

/** Para tests. */
export function clearAccountPauses(): void {
  pauses.clear();
}
