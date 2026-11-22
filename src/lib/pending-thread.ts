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

/** El emparejado no se pinta como pendiente: solo sirve para quitar la copia local. */
export function unmatchedPending<T extends { matchedMessageKey?: string | null }>(pending: readonly T[]): T[] {
  return pending.filter((item) => !item.matchedMessageKey);
}

export function confirmedMatches<T extends { id: string; matchedMessageKey?: string | null }>(
  pending: readonly T[],
): Array<{ clientId: string; messageId: string }> {
  return pending.flatMap((item) => (
    item.matchedMessageKey ? [{ clientId: item.id, messageId: item.matchedMessageKey }] : []
  ));
}
