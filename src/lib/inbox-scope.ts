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

export type CreatorChipBadge = { messages: number; notices: number };

/** Rojo y verde de cada pestaña. Una cuenta sin chip no entra, y no hay un total mezclado. */
export function creatorChipBadges(input: {
  threads: readonly { creatorId: string; unread: number | null }[];
  notices: readonly { creatorId: string; unread: number | null }[];
  visibleIds: readonly string[];
}): Record<string, CreatorChipBadge> {
  const visible = new Set(input.visibleIds.filter((id) => id && id !== "all"));
  const messages = unreadByCreator(input.threads);
  const notices = new Map<string, number>();
  for (const row of input.notices) {
    if (!visible.has(row.creatorId) || notices.has(row.creatorId)) continue;
    if (row.unread == null || row.unread <= 0) continue;
    notices.set(row.creatorId, row.unread);
  }
  const badges: Record<string, CreatorChipBadge> = {};
  for (const id of visible) {
    const messageCount = messages[id] ?? 0;
    const noticeCount = notices.get(id) ?? 0;
    if (messageCount <= 0 && noticeCount <= 0) continue;
    badges[id] = { messages: messageCount, notices: noticeCount };
  }
  return badges;
}

/** Badges que se pintan. El menú no suma un total, y una cuenta sin chip no tiene badge. */
export function visibleCreatorBadges(
  threads: readonly { creatorId: string; unread: number | null }[],
  visibleIds: readonly string[],
): Record<string, number> {
  const counts = unreadByCreator(threads);
  const visible = new Set(visibleIds.filter((id) => id && id !== "all"));
  const badges: Record<string, number> = {};
  for (const [id, count] of Object.entries(counts)) {
    if (visible.has(id) && count > 0) badges[id] = count;
  }
  return badges;
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
