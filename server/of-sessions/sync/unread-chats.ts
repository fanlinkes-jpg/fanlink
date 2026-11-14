/**
 * No leídos de `/api2/v2/chats`. Sale de `unreadMessagesCount` (o `unread`).
 * Si el campo no viene, no se guarda un 0: la fila no se pone en negrita
 * y el log nombra a la creadora. Marcar leído en OnlyFans al abrir el hilo
 * solo sale si FANLINK_CHAT_MARK_READ está encendido.
 */

export function unreadCountOf(record: Record<string, unknown>): number | null {
  const key = ["unreadMessagesCount", "unread_messages_count", "unread"].find((name) => name in record);
  if (!key) return null;
  const value = record[key];
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  return Math.min(999, Math.trunc(number));
}

export function higherUnread(left: number | null, right: number | null): number | null {
  if (left == null) return right;
  if (right == null) return left;
  return Math.max(left, right);
}

export function unreadChatRow(unread: number | null): { bold: boolean; badge: number | null } {
  if (unread == null || unread <= 0) return { bold: false, badge: null };
  return { bold: true, badge: unread };
}

/**
 * Chats con al menos un mensaje sin leer en la cuenta elegida.
 * Null mientras carga, si la lectura falló, o si ningún hilo de esa cuenta
 * trae una cifra. No es la suma de mensajes.
 */
export function unreadTotalFor(
  status: "loading" | "error" | "ready",
  threads: readonly { creatorId: string; unread: number | null }[],
  creatorId: string,
): number | null {
  if (status !== "ready") return null;
  const rows = creatorId === "all" ? threads : threads.filter((thread) => thread.creatorId === creatorId);
  if (rows.length === 0 || rows.every((thread) => thread.unread == null)) return null;
  return rows.filter((thread) => (thread.unread ?? 0) > 0).length;
}

/** Lo que esta lectura trae se pisa, también un 0. Lo que no trae se queda. */
export function unreadAfterListRead<T extends { threadKey: string; unread: number | null }>(
  stored: readonly T[],
  listed: readonly { threadKey: string; unread: number | null }[],
): T[] {
  const fresh = new Map(listed.map((thread) => [thread.threadKey, thread.unread]));
  return stored.map((thread) => (
    fresh.has(thread.threadKey)
      ? { ...thread, unread: fresh.get(thread.threadKey) ?? thread.unread }
      : thread
  ));
}

export function noteMissingUnread(creatorId: string | null | undefined, missing: number, log: (line: string) => void = console.info): void {
  if (missing <= 0) return;
  log(`[fanlink:chat] api lista creator=${creatorId?.trim() || "-"} sin unreadMessagesCount hilos=${missing}`);
}
