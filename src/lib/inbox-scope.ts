export const INBOX_CREATOR_KEY = "fanlink.mensajes.creator";

export function readInboxCreator(storage: { getItem: (key: string) => string | null } | null): string | null {
  try {
    return storage?.getItem(INBOX_CREATOR_KEY) ?? null;
  } catch {
    return null;
  }
}

export function writeInboxCreator(storage: { setItem: (key: string, value: string) => void } | null, id: string): void {
  const saved = rememberInboxCreator(id);
  if (!saved || !storage) return;
  try {
    storage.setItem(INBOX_CREATOR_KEY, saved);
  } catch {
    /* el navegador puede bloquear el almacén */
  }
}

/** Creadoras de la bandeja. Si el workspace no tiene ninguna, valen las cuentas de OnlyFans. */
export function inboxCreators(
  workspace: readonly { id: string }[],
  accounts: readonly { creatorId: string }[],
): { id: string }[] {
  const assigned = workspace.map((creator) => creator.id).filter((id) => id && id !== "all");
  if (assigned.length > 0) return assigned.map((id) => ({ id }));
  const seen = new Set<string>();
  const fallback: { id: string }[] = [];
  for (const account of accounts) {
    const id = account.creatorId.trim();
    if (!id || id === "all" || seen.has(id)) continue;
    seen.add(id);
    fallback.push({ id });
  }
  return fallback;
}

/** La bandeja de Mensajes nunca es «Todas». La última creadora usada gana; si no, la primera. */
export function resolveInboxCreator(input: {
  requested: string | null;
  creators: readonly { id: string }[];
  remembered: string | null;
}): string | null {
  const ids = input.creators.map((creator) => creator.id).filter((id) => id && id !== "all");
  if (ids.length === 0) return null;
  if (input.requested && input.requested !== "all" && ids.includes(input.requested)) return input.requested;
  if (input.remembered && input.remembered !== "all" && ids.includes(input.remembered)) return input.remembered;
  return ids[0] ?? null;
}

export function rememberInboxCreator(id: string | null): string | null {
  if (!id || id === "all") return null;
  return id;
}

/** Suma de los badges que se pintan. Una cuenta sin chip no entra, aunque el servidor traiga sus hilos. */
export function visibleUnreadTotal(badges: Readonly<Record<string, number>>, visibleIds: readonly string[]): number {
  let total = 0;
  const seen = new Set<string>();
  for (const id of visibleIds) {
    if (!id || id === "all" || seen.has(id)) continue;
    seen.add(id);
    total += badges[id] ?? 0;
  }
  return total;
}

/** Chats con no leídos, por creadora. No mezcla cuentas. */
export function unreadByCreator(threads: readonly { creatorId: string; unread: number | null }[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const thread of threads) {
    if (!thread.creatorId || thread.creatorId === "all" || (thread.unread ?? 0) <= 0) continue;
    counts[thread.creatorId] = (counts[thread.creatorId] ?? 0) + 1;
  }
  return counts;
}

/** El total del menú no abre una vista mezclada: lleva a la primera creadora con pendientes. */
export function creatorWithPending(creatorIds: readonly string[], threads: readonly { creatorId: string; unread: number | null }[]): string | null {
  const counts = unreadByCreator(threads);
  return creatorIds.find((id) => (counts[id] ?? 0) > 0) ?? null;
}

/** La lista de /mensajes. «Todas», una URL vieja o un id inválido no mezclan hilos. */
export function inboxThreadList<T extends { creatorId: string }>(
  threads: readonly T[],
  input: { requested: string | null; creators: readonly { id: string }[]; remembered: string | null },
): { creatorId: string | null; threads: T[] } {
  const creatorId = resolveInboxCreator(input);
  return { creatorId, threads: rowsForCreator(threads, creatorId) };
}

export function rowsForCreator<T extends { creatorId: string }>(rows: readonly T[], creatorId: string | null): T[] {
  if (!creatorId || creatorId === "all") return [];
  return rows.filter((row) => row.creatorId === creatorId);
}
