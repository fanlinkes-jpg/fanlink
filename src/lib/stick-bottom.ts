/** Para volver a pegarse al final la persona tiene que bajar hasta menos de esto (px). */
export const STICK_PX = 30;
/** Una acción de la persona (rueda, dedo, teclado, barra) cuenta como intención durante este tiempo. */
export const INTENT_MS = 1200;

export type ScrollSample = { top: number; height: number; client: number };

/**
 * ¿Hay que seguir pegado al final después de un evento de scroll?
 * - Si el scroll sube (aunque sea un píxel) y no es porque el contenido encogió ni porque la lista
 *   creció, la persona se va: se suelta el final.
 * - Para volver a pegarse hay que bajar hasta menos de STICK_PX con una acción de la persona.
 * - Cualquier otro scroll lo provoca el navegador (la lista se encoge, crece un medio): no cambia nada.
 */
export function stickAfterScroll(input: {
  now: ScrollSample;
  prev: ScrollSample;
  wasStuck: boolean;
  userActive: boolean;
}): boolean {
  const { now, prev } = input;
  const distance = now.height - now.top - now.client;
  const movedUp = now.top < prev.top - 0.5 && now.height >= prev.height - 0.5 && now.client <= prev.client + 0.5;
  if (movedUp) return false;
  if (distance < STICK_PX) return input.wasStuck || (input.userActive && now.top > prev.top + 0.5);
  return input.wasStuck;
}

export function userRecently(lastUserAt: number, now: number): boolean {
  return now - lastUserAt < INTENT_MS;
}

/** Gestos que van hacia arriba: rueda, teclas de subir. El resto del teclado no suelta el final. */
export function keyScrollsUp(event: { key: string; shiftKey?: boolean }): boolean {
  return event.key === "ArrowUp" || event.key === "PageUp" || event.key === "Home" || (event.key === " " && event.shiftKey === true);
}

/**
 * Cuánto hay que mover el scroll para que lo que se estaba leyendo no se mueva
 * cuando entra contenido por arriba (historial antiguo): lo que se desplazó el mensaje ancla.
 */
export function anchorShift(before: { offset: number } | null, afterOffset: number | null): number {
  if (!before || afterOffset == null) return 0;
  const delta = afterOffset - before.offset;
  return Math.abs(delta) > 0.5 ? delta : 0;
}
