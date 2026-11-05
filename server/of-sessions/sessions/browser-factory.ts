import { chromium, type BrowserContext } from "playwright";
import { messages } from "../messages.ts";

export interface ManagedBrowser {
  newContext(options: { storageState: string }): Promise<BrowserContext>;
  close(): Promise<void>;
}

export interface PersistentLaunchOptions {
  headless: boolean;
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
      return chromium.launchPersistentContext(userDataDir, {
        headless: options.headless,
        viewport: { width: 1280, height: 800 },
        locale: "es-ES",
        timezoneId: "Europe/Madrid",
      });
    },
    async launch() {
      const browser = await chromium.launch({ headless: true });
      return {
        newContext(options) {
          return browser.newContext({ storageState: options.storageState });
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
