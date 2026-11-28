export type FindMessage = { messageKey: string; body: string; sentAt: string };

/** Sin mayúsculas ni acentos, para que «sesion» encuentre «Sesión». */
export function foldText(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

export const FIND_MIN_CHARS = 2;
export const FIND_MAX_MATCHES = 500;

/** Mensajes de la conversación que contienen el texto, del más viejo al más nuevo. */
export function findMessages(messages: readonly FindMessage[], query: string): string[] {
  const needle = foldText(query.trim());
  if (needle.length < FIND_MIN_CHARS) return [];
  return [...messages]
    .sort((left, right) => left.sentAt.localeCompare(right.sentAt))
    .filter((message) => foldText(message.body).includes(needle))
    .map((message) => message.messageKey)
    .slice(0, FIND_MAX_MATCHES);
}

/** Siguiente o anterior resultado, dando la vuelta. */
export function stepMatch(index: number, count: number, direction: 1 | -1): number {
  if (count <= 0) return 0;
  return (index + direction + count) % count;
}

/** Trozos del texto con el fragmento encontrado marcado. */
export function highlightParts(body: string, query: string): Array<{ text: string; hit: boolean }> {
  const needle = foldText(query.trim());
  if (needle.length < FIND_MIN_CHARS) return [{ text: body, hit: false }];
  const folded = foldText(body);
  // El plegado puede cambiar la longitud (ligaduras raras): en ese caso no se marca.
  if (folded.length !== body.length) return [{ text: body, hit: false }];
  const parts: Array<{ text: string; hit: boolean }> = [];
  let from = 0;
  for (;;) {
    const at = folded.indexOf(needle, from);
    if (at < 0) break;
    if (at > from) parts.push({ text: body.slice(from, at), hit: false });
    parts.push({ text: body.slice(at, at + needle.length), hit: true });
    from = at + needle.length;
  }
  if (from < body.length) parts.push({ text: body.slice(from), hit: false });
  return parts.length > 0 ? parts : [{ text: body, hit: false }];
}
