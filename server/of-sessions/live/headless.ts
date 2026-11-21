import type { DisplayEnv } from "../config.ts";

/** Cómo arranca la vista. En un Mac, fuera de pantalla: --headless=new no pasa el reto. */
export type LiveLaunchMode = "offscreen" | "headless" | "window";

export type LiveVisibility = "window" | "minimized" | "headless";

/**
 * La ventana real arranca minimizada, también la primera vez, y no se
 * vuelve a mostrar. El reto, si aparece, se ve en el canvas del CRM.
 * headless=new no se usa: vuelve a disparar el reto.
 */
export function liveVisibility(asked: LiveLaunchMode): { visibility: LiveVisibility; reason: string } {
  if (asked === "headless") return { visibility: "headless", reason: "forzada" };
  if (asked === "window") return { visibility: "window", reason: "forzada" };
  return { visibility: "minimized", reason: "arranque" };
}

/**
 * Por defecto `offscreen`, que con cookie pasa a headless y sin ella a
 * ventana visible. FANLINK_LIVE_VIEW_HEADLESS=true fuerza `--headless=new`.
 * `false` abre la ventana. Sin pantalla solo cabe headless.
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
