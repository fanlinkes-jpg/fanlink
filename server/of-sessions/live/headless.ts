import type { DisplayEnv } from "../config.ts";

/**
 * El live view reutiliza el perfil y el proxy de la cuenta, pero no el
 * Chromium headless de las lecturas. Por defecto es visible cuando hay
 * pantalla, igual que Conectar. FANLINK_LIVE_VIEW_HEADLESS=true fuerza
 * headless; false fuerza ventana.
 */
export function liveViewHeadless(
  env: NodeJS.ProcessEnv = process.env,
  display: DisplayEnv,
): boolean {
  const raw = env.FANLINK_LIVE_VIEW_HEADLESS?.trim().toLowerCase();
  if (raw === "true" || raw === "1") return true;
  if (raw === "false" || raw === "0") return false;
  if (display.platform === "win32" || display.platform === "darwin") return false;
  return !(display.display || display.wayland);
}
