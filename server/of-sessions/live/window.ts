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

/**
 * Minimiza esta ventana aunque Chrome la haya restaurado maximizada.
 * `shown` significa que no estaba minimizada y hubo que volver a ocultarla.
 */
export async function tuckLiveWindow(send: CdpSend): Promise<"hidden" | "shown" | "fail"> {
  try {
    const got = await send("Browser.getWindowForTarget");
    const windowId = windowIdOf(got);
    if (windowId == null) return "fail";
    const current = await send("Browser.getWindowBounds", { windowId });
    const state = windowStateOf(current);
    await send("Browser.setWindowBounds", { windowId, bounds: { windowState: "minimized" } });
    return state === "minimized" ? "hidden" : "shown";
  } catch {
    return "fail";
  }
}

export function minimizeLiveWindow(send: CdpSend): Promise<boolean> {
  return setLiveWindowState(send, "minimized");
}

/**
 * Un solo AppleScript para todos los Chromium de la vista. `process "nombre"`
 * solo toca el primero y, al abrir el segundo, el otro vuelve a verse.
 */
export function liveHideScript(): string {
  return [
    'tell application "System Events"',
    "set hiddenCount to 0",
    `repeat with proc in (every process whose name is "${CHROME_FOR_TESTING}")`,
    "try",
    "set visible of proc to false",
    "set hiddenCount to hiddenCount + 1",
    "end try",
    "end repeat",
    "return hiddenCount",
    "end tell",
  ].join("\n");
}

/**
 * Con Chrome estable el proceso se llama «Google Chrome», el mismo del dueño.
 * Un osascript sobre ese nombre ocultaría su navegador personal. Ahí solo se
 * minimiza por CDP, ventana a ventana, en el perfil de la cuenta.
 * El AppleScript queda para Chrome for Testing, que no es el Chrome personal.
 */
let hideTestingProcess = false;

export function setLiveProcessHide(enabled: boolean): void {
  hideTestingProcess = enabled;
}

export function liveProcessHideEnabled(): boolean {
  return hideTestingProcess;
}

/** Los ocultados van en cola: dos perfiles no se pisan el AppleScript. */
let hideQueue: Promise<boolean> = Promise.resolve(false);

/**
 * En macOS esconde los procesos «Google Chrome for Testing», no «Google Chrome».
 * Fuera de darwin, o con Chrome estable, no hace nada.
 */
export function hideLiveProcess(platform: NodeJS.Platform = process.platform): Promise<boolean> {
  if (!hideTestingProcess || platform !== "darwin") return Promise.resolve(false);
  const run = hideQueue.then(() => runHide(), () => runHide());
  hideQueue = run.catch(() => false);
  return run;
}

function runHide(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile("osascript", ["-e", liveHideScript()], { timeout: 4_000 }, (error, stdout) => {
      if (error) {
        resolve(false);
        return;
      }
      const count = Number(String(stdout).trim());
      resolve(Number.isFinite(count) && count > 0);
    });
  });
}

function windowIdOf(value: unknown): number | null {
  if (!value || typeof value !== "object" || !("windowId" in value)) return null;
  const id = value.windowId;
  return typeof id === "number" && Number.isInteger(id) ? id : null;
}

function windowStateOf(value: unknown): string {
  if (!value || typeof value !== "object" || !("bounds" in value)) return "";
  const bounds = value.bounds;
  if (!bounds || typeof bounds !== "object" || !("windowState" in bounds)) return "";
  const state = bounds.windowState;
  return typeof state === "string" ? state : "";
}
