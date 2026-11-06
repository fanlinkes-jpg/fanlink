export type PendingThreadRef = {
  creatorId: string;
  threadKey: string;
};

/** Pendientes del hilo abierto. El mismo threadKey en otra creadora no cuenta. */
export function pendingForThread<T extends PendingThreadRef>(
  pending: readonly T[],
  selected: PendingThreadRef | null,
): T[] {
  if (!selected) return [];
  return pending.filter((item) => item.creatorId === selected.creatorId && item.threadKey === selected.threadKey);
}
