import type { DisplayEnv } from "../config.ts";

/** Cómo arranca la vista. En un Mac, fuera de pantalla: --headless=new no pasa el reto. */
export type LiveLaunchMode = "offscreen" | "headless" | "window";

/**
 * Por defecto, el mismo Chromium que Conectar, con la ventana en
 * `-32000,-32000` (1440×900, sin foco). FANLINK_LIVE_VIEW_HEADLESS=true
 * fuerza `--headless=new`. `false` abre la ventana en el escritorio.
 * Sin pantalla (Linux sin DISPLAY) no hay otra salida que headless.
 */
export function liveLaunchMode(
  env: NodeJS.ProcessEnv = process.env,
  display: DisplayEnv,
): LiveLaunchMode {
  const raw = env.FANLINK_LIVE_VIEW_HEADLESS?.trim().toLowerCase();
  if (raw === "true" || raw === "1") return "headless";
  if (raw === "false" || raw === "0") return "window";
  if (display.platform === "win32" || display.platform === "darwin") return "offscreen";
  if (display.display || display.wayland) return "offscreen";
  return "headless";
}
