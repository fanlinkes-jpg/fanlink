import { chromium, type BrowserContext } from "playwright";
import type { LiveLaunchMode } from "../live/headless.ts";
import { messages } from "../messages.ts";

/**
 * La misma huella en Conectar, Comprobar, Sincronizar y Chats.
 * OnlyFans ata la sesión al perfil: un Chromium nuevo, headless o con otro
 * user agent, recibe users/me de invitado aunque las cookies sigan guardadas.
 */
export const BROWSER_FINGERPRINT = {
  userAgent:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  viewport: { width: 1440, height: 900 },
  locale: "es-ES",
  timezoneId: "Europe/Madrid",
} as const;

export type BrowserProxy = { server: string; username?: string; password?: string };

export interface ManagedBrowser {
  newContext(options: { storageState: string; proxy?: BrowserProxy | null }): Promise<BrowserContext>;
  close(): Promise<void>;
}

export interface PersistentLaunchOptions {
  headless: boolean;
  proxy?: BrowserProxy | null;
  /**
   * Vista nativa. `offscreen` es el Chromium de Conectar con la ventana fuera
   * de la pantalla. `headless` usa `--headless=new` (no el shell). `window`
   * la muestra. Playwright 1.64 con `headless: true` arranca otro binario.
   */
  live?: LiveLaunchMode;
}

/** Quita navigator.webdriver. Va en todos los modos de la vista, también la ventana. */
export const LIVE_BASE_ARGS = ["--disable-blink-features=AutomationControlled"] as const;

/** Chromium completo, sin el shell. */
export const LIVE_HEADLESS_ARGS = ["--headless=new", ...LIVE_BASE_ARGS] as const;

/** La ventana visible. Misma huella de lanzamiento que el modo sin cookie. */
export const LIVE_WINDOW_ARGS = LIVE_BASE_ARGS;

export function persistentContextLaunchOptions(options: PersistentLaunchOptions): {
  headless: boolean;
  ignoreDefaultArgs?: string[];
  args?: string[];
  userAgent?: string;
  viewport: { width: number; height: number } | null;
  locale: string;
  timezoneId: string;
  proxy?: BrowserProxy;
} {
  const live = options.live;
  const isLive = live === "headless" || live === "offscreen" || live === "window";
  const args = live === "headless" ? LIVE_HEADLESS_ARGS : isLive ? [...LIVE_WINDOW_ARGS] : undefined;
  return {
    headless: isLive ? false : options.headless,
    ...(isLive ? { ignoreDefaultArgs: ["--enable-automation"], args: args ? [...args] : [] } : {}),
    userAgent: BROWSER_FINGERPRINT.userAgent,
    viewport: BROWSER_FINGERPRINT.viewport,
    locale: BROWSER_FINGERPRINT.locale,
    timezoneId: BROWSER_FINGERPRINT.timezoneId,
    ...(options.proxy ? { proxy: options.proxy } : {}),
  };
}

export interface BrowserFactory {
  launchPersistentContext(
    userDataDir: string,
    options: PersistentLaunchOptions,
  ): Promise<BrowserContext>;
  launch(): Promise<ManagedBrowser>;
}

export function createPlaywrightFactory(): BrowserFactory {
  return {
    async launchPersistentContext(userDataDir, options) {
      return chromium.launchPersistentContext(userDataDir, persistentContextLaunchOptions(options));
    },
    async launch() {
      const browser = await chromium.launch({ headless: true });
      return {
        newContext(options) {
          return browser.newContext({
            storageState: options.storageState,
            userAgent: BROWSER_FINGERPRINT.userAgent,
            viewport: BROWSER_FINGERPRINT.viewport,
            locale: BROWSER_FINGERPRINT.locale,
            timezoneId: BROWSER_FINGERPRINT.timezoneId,
            ...(options.proxy ? { proxy: options.proxy } : {}),
          });
        },
        close() {
          return browser.close();
        },
      };
    },
  };
}

export function explainLaunchError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  if (
    message.includes("Executable doesn't exist") ||
    message.includes("browserType.launch") ||
    message.includes("Please run the following command")
  ) {
    return new Error(messages.browserMissing);
  }
  return error instanceof Error ? error : new Error(message);
}
