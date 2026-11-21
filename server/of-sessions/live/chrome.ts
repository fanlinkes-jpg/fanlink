import { accessSync, constants } from "node:fs";

/** Rutas habituales del Google Chrome estable. No es el Chrome personal: el perfil es el de la cuenta. */
export const LIVE_CHROME_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/google-chrome",
  "/opt/google/chrome/chrome",
] as const;

export type LiveChromeSource = "ruta" | "estable" | "testing";

export type LiveChromeChoice = {
  source: LiveChromeSource;
  executablePath?: string;
  channel?: "chrome";
  /** La ruta pedida no existe: se usa Chrome for Testing. */
  missingPath: boolean;
};

/**
 * Chrome estable trae Widevine. Chrome for Testing no.
 * La huella (UA, brands, viewport, idioma) se fuerza aparte y no cambia.
 */
export function chooseLiveChrome(
  env: NodeJS.ProcessEnv,
  exists: (path: string) => boolean = chromePathExists,
): LiveChromeChoice {
  const custom = env.FANLINK_LIVE_VIEW_CHROME_PATH?.trim();
  if (custom) {
    if (exists(custom)) return { source: "ruta", executablePath: custom, missingPath: false };
    return { source: "testing", missingPath: true };
  }
  if (LIVE_CHROME_CANDIDATES.some((path) => exists(path))) {
    return { source: "estable", channel: "chrome", missingPath: false };
  }
  return { source: "testing", missingPath: false };
}

let liveOrigin: LiveChromeSource = "testing";

export function rememberLiveChrome(choice: LiveChromeChoice): void {
  liveOrigin = choice.source;
}

export function liveChromeOrigin(): LiveChromeSource {
  return liveOrigin;
}

export function chromePathExists(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Se ejecuta dentro de la página. No cierra sobre nada del servidor. */
export async function widevineProbe(): Promise<boolean> {
  const nav = navigator as Navigator & {
    requestMediaKeySystemAccess?: (key: string, configs: unknown[]) => Promise<unknown>;
  };
  if (typeof nav.requestMediaKeySystemAccess !== "function") return false;
  try {
    await nav.requestMediaKeySystemAccess("com.widevine.alpha", [{
      initDataTypes: ["cenc"],
      videoCapabilities: [{ contentType: 'video/mp4; codecs="avc1.42E01E"' }],
    }]);
    return true;
  } catch {
    return false;
  }
}
