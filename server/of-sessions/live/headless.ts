import type { DisplayEnv } from "../config.ts";

/** Cómo arranca la vista. En un Mac, fuera de pantalla: --headless=new no pasa el reto. */
export type LiveLaunchMode = "offscreen" | "headless" | "window";

/**
 * Sin cf_clearance la ventana es visible: macOS ignora una posición negativa
 * y minimizar corta el screencast. Con la cookie ya guardada, headless=new.
 */
export function liveLaunchForClearance(asked: LiveLaunchMode, hasClearance: boolean): LiveLaunchMode {
  if (asked !== "offscreen") return asked;
  return hasClearance ? "headless" : "window";
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
