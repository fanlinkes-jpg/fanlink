import type { DisplayEnv } from "../config.ts";

/**
 * La vista nativa no abre ventana: la página se ve solo en el CRM.
 * FANLINK_LIVE_VIEW_HEADLESS=false fuerza la ventana de depuración.
 * El argumento de pantalla se conserva para los llamadores; no decide.
 */
export function liveViewHeadless(
  env: NodeJS.ProcessEnv = process.env,
  display: DisplayEnv,
): boolean {
  void display;
  const raw = env.FANLINK_LIVE_VIEW_HEADLESS?.trim().toLowerCase();
  if (raw === "false" || raw === "0") return false;
  return true;
}
