/** Distancia al final (px) que todavía cuenta como «estar abajo». */
export const STICK_PX = 80;
/** Una acción de la persona (rueda, dedo, teclado, barra) cuenta como intención durante este tiempo. */
export const INTENT_MS = 1200;

/**
 * ¿Hay que seguir pegado al final después de un evento de scroll?
 * Abajo del todo: sí. Lejos del final: solo se suelta si lo hizo la persona.
 * Un scroll que provoca el propio navegador (la lista se encoge, cambia el alto de un medio)
 * no suelta el final.
 */
export function stickAfterScroll(input: { distance: number; userRecently: boolean; wasStuck: boolean }): boolean {
  if (input.distance < STICK_PX) return true;
  return input.userRecently ? false : input.wasStuck;
}

export function userRecently(lastUserAt: number, now: number): boolean {
  return now - lastUserAt < INTENT_MS;
}
