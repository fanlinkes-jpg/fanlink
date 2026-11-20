import type { DisplayEnv } from "../config.ts";

/** Cómo arranca la vista. En un Mac, fuera de pantalla: --headless=new no pasa el reto. */
export type LiveLaunchMode = "offscreen" | "headless" | "window";

export type LiveVisibility = "window" | "minimized" | "headless";

/**
 * La segunda vez no usa headless=new: ese modo volvió a disparar el reto.
 * Con cf_clearance o tras la primera vista, la ventana real se minimiza
 * (el screencast sigue). La primera apertura de la cuenta es visible.
 */
export function liveVisibility(input: {
  asked: LiveLaunchMode;
  clearance: boolean;
  seen: boolean;
}): { visibility: LiveVisibility; reason: string } {
  if (input.asked === "headless") return { visibility: "headless", reason: "forzada" };
  if (input.asked === "window") return { visibility: "window", reason: "forzada" };
  if (input.clearance) return { visibility: "minimized", reason: "cf_clearance" };
  if (input.seen) return { visibility: "minimized", reason: "ya-vista" };
  return { visibility: "window", reason: "primera" };
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
