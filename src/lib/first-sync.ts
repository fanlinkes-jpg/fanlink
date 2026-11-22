/** Si hace falta la lectura al guardar la sesión. Una pausa o una lectura reciente no disparan otra. */
export function shouldKickCreatorRead(input: {
  paused: boolean;
  lastAttemptAt: string | null;
  now: number;
  intervalMs: number;
}): boolean {
  if (input.paused) return false;
  if (!input.lastAttemptAt) return true;
  const at = Date.parse(input.lastAttemptAt);
  if (!Number.isFinite(at)) return true;
  return input.now - at >= input.intervalMs;
}
