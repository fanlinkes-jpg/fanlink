/** Une páginas del hilo. El id de OnlyFans gana: no se pide ni se pinta dos veces. */
export function mergeHistoryMessages<T extends { messageKey: string; sentAt: string }>(current: readonly T[], incoming: readonly T[]): T[] {
  const map = new Map<string, T>();
  for (const message of [...current, ...incoming]) {
    if (!message.messageKey) continue;
    map.set(message.messageKey, message);
  }
  return [...map.values()].sort((left, right) => left.sentAt.localeCompare(right.sentAt) || left.messageKey.localeCompare(right.messageKey));
}

/** Al anteponer mensajes, el que se veía sigue en el mismo sitio. */
export function scrollAfterPrepend(before: { scrollHeight: number; scrollTop: number }, nextScrollHeight: number): number {
  return before.scrollTop + Math.max(0, nextScrollHeight - before.scrollHeight);
}

export type ScrollAnchor = { id: string; offset: number };

/** El primer mensaje que asoma, y cuántos px hay de su borde al borde de la lista. */
export function scrollAnchor(rows: readonly { id: string; top: number; height: number }[], viewportTop: number): ScrollAnchor | null {
  const visible = rows.find((row) => row.top + row.height > viewportTop + 1);
  if (!visible) return null;
  return { id: visible.id, offset: visible.top - viewportTop };
}

/** Cuánto hay que mover el scroll para que el ancla quede otra vez a `offset` px del borde. */
export function scrollDeltaForAnchor(anchor: ScrollAnchor, elementTop: number, viewportTop: number): number {
  return elementTop - viewportTop - anchor.offset;
}
