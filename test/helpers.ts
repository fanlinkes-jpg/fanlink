import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import { chromium, type Page } from "playwright";
import type { Express } from "express";
import type { FanlinkConfig } from "../src/config.js";
import type { BrowserFactory } from "../src/sessions/browser-factory.js";
import type { DisplayEnv } from "../src/config.js";

export const PASSWORD = "super-secret-password";

export const testDisplay: DisplayEnv = { platform: "linux", display: ":1" };

export async function tempDataDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "fanlink-"));
}

export async function removeDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

export function testConfig(dataDir: string, overrides: Partial<FanlinkConfig> = {}): FanlinkConfig {
  return {
    dataDir,
    host: "127.0.0.1",
    port: 0,
    headlessLogin: true,
    openLoginOnInvalidate: true,
    loginTimeoutMs: 20_000,
    probeTimeoutMs: 15_000,
    ...overrides,
  };
}

export function recordingFactory(events: string[]): BrowserFactory {
  return {
    async launchPersistentContext(userDataDir, options) {
      events.push(`persistent:${String(options.headless)}:${path.basename(userDataDir)}`);
      return chromium.launchPersistentContext(userDataDir, {
        headless: options.headless,
        viewport: { width: 1100, height: 700 },
      });
    },
    async launch() {
      events.push("launch");
      const browser = await chromium.launch({ headless: true });
      return {
        async newContext(options) {
          events.push(`context:${path.basename(options.storageState)}`);
          return browser.newContext({ storageState: options.storageState });
        },
        async close() {
          await browser.close();
        },
      };
    },
  };
}

export async function listen(app: Express): Promise<{ url: string; close(): Promise<void> }> {
  const server: Server = createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("sin puerto");
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

export async function completeFixtureLogin(page: Page): Promise<void> {
  await page.waitForLoadState("domcontentloaded");
  if (new URL(page.url()).pathname === "/dashboard") return;
  await page.fill('input[name="user"]', "creator");
  await page.fill('input[name="password"]', PASSWORD);
  await Promise.all([page.waitForURL(/\/dashboard$/), page.click('button[type="submit"]')]);
}

export async function waitFor(predicate: () => Promise<boolean> | boolean, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("se agotó la espera");
}
