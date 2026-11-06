const tails = new Map<string, Promise<void>>();

/**
 * Una lectura de medio por cuenta. No abre varios navegadores a la vez
 * y deja hueco a la sincronización entre una y otra.
 */
export function runMediaTask<T>(creatorId: string, task: () => Promise<T>): Promise<T> {
  const previous = tails.get(creatorId) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(task);
  const done = run.then(() => undefined, () => undefined);
  tails.set(creatorId, done);
  return run;
}

export function resetMediaGate(): void {
  tails.clear();
}
