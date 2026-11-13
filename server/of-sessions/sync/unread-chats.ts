/**
 * No leídos de `/api2/v2/chats`. Sale de `unreadMessagesCount` (o `unread`).
 * Si el campo no viene, no se guarda un 0: la fila no se pone en negrita
 * y el log nombra a la creadora. Abrir el hilo en el CRM no marca leído
 * en OnlyFans. `FANLINK_MARK_CHAT_READ` queda apagado.
 */

export function markChatReadEnabled(raw = process.env.FANLINK_MARK_CHAT_READ): boolean {
  return raw === "true";
}

/** El no leído que sigue mostrando la lista después de abrir el hilo. */
export function unreadAfterOpen(unread: number | null, enabled = markChatReadEnabled()): number | null {
  if (!enabled) return unread;
  return unread;
}

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

/** Chats con al menos un mensaje sin leer. Es el total de la pestaña, no la suma de mensajes. */
export function unreadChatTotal(threads: readonly { unread: number | null }[]): number {
  return threads.filter((thread) => (thread.unread ?? 0) > 0).length;
}

export function noteMissingUnread(creatorId: string | null | undefined, missing: number, log: (line: string) => void = console.info): void {
  if (missing <= 0) return;
  log(`[fanlink:chat] api lista creator=${creatorId?.trim() || "-"} sin unreadMessagesCount hilos=${missing}`);
}
