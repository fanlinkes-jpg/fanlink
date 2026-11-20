import { execFile } from "node:child_process";

type CdpSend = (method: string, params?: Record<string, unknown>) => Promise<unknown>;

const CHROME_FOR_TESTING = "Google Chrome for Testing";

type LiveWindowState = "minimized" | "normal";

/**
 * El contexto sigue vivo si acepta páginas. Uno cerrado lanza al leerlas.
 * Sin `pages` no se puede saber (los dobles de test): se trata como vivo
 * para no negar la reutilización.
 */
export function liveContextOpen(context: {
  browser?: () => { isConnected?: () => boolean } | null;
  pages?: () => unknown;
}): boolean {
  try {
    if (typeof context.pages !== "function") return true;
    const browser = context.browser?.() ?? null;
    if (browser?.isConnected?.() === false) return false;
    context.pages();
    return true;
  } catch {
    return false;
  }
}

/** CDP. Minimizar no corta el screencast: con la página en movimiento siguen los frames. */
export async function setLiveWindowState(send: CdpSend, state: LiveWindowState): Promise<boolean> {
  try {
    const got = await send("Browser.getWindowForTarget");
    const windowId = windowIdOf(got);
    if (windowId == null) return false;
    await send("Browser.setWindowBounds", { windowId, bounds: { windowState: state } });
    return true;
  } catch {
    return false;
  }
}

export function minimizeLiveWindow(send: CdpSend): Promise<boolean> {
  return setLiveWindowState(send, "minimized");
}

/**
 * En macOS esconde el proceso del escritorio y del selector de apps.
 * El Dock puede conservar un punto: Chromium no admite LSUIElement.
 * Fuera de darwin no hace nada.
 */
export function hideLiveProcess(platform: NodeJS.Platform = process.platform): Promise<boolean> {
  if (platform !== "darwin") return Promise.resolve(false);
  return new Promise((resolve) => {
    execFile(
      "osascript",
      ["-e", `tell application "System Events" to set visible of process "${CHROME_FOR_TESTING}" to false`],
      { timeout: 3_000 },
      (error) => resolve(!error),
    );
  });
}

function windowIdOf(value: unknown): number | null {
  if (!value || typeof value !== "object" || !("windowId" in value)) return null;
  const id = value.windowId;
  return typeof id === "number" && Number.isInteger(id) ? id : null;
}
