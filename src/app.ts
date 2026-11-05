import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import type { DisplayEnv, FanlinkConfig } from "./config.js";
import { currentDisplayEnv } from "./config.js";
import { registerRoutes } from "./http/routes.js";
import { createPlaywrightFactory, type BrowserFactory } from "./sessions/browser-factory.js";
import { preparePrivateDir } from "./sessions/private-dir.js";
import { SessionManager } from "./sessions/session-manager.js";
import type { SiteAdapter } from "./sessions/site.js";
import { AccountStore } from "./store/account-store.js";
import type { Page } from "playwright";

export interface CreateAppOptions {
  config: FanlinkConfig;
  site: SiteAdapter;
  browserFactory?: BrowserFactory;
  displayEnv?: DisplayEnv;
  now?: () => Date;
  afterLoginPageOpen?: (page: Page, accountId: string) => Promise<void> | void;
  logger?: { info(message: string): void; warn(message: string): void };
}

export async function createApp(options: CreateAppOptions) {
  await preparePrivateDir(options.config.dataDir);
  await preparePrivateDir(path.join(options.config.dataDir, "profiles"));
  await preparePrivateDir(path.join(options.config.dataDir, "sessions"));

  const store = new AccountStore(path.join(options.config.dataDir, "accounts.json"), options.now);
  await store.init();
  const sessions = new SessionManager({
    config: options.config,
    store,
    site: options.site,
    browsers: options.browserFactory ?? createPlaywrightFactory(),
    displayEnv: options.displayEnv ?? currentDisplayEnv(),
    now: options.now,
    afterLoginPageOpen: options.afterLoginPageOpen,
    logger: options.logger,
  });

  const app = express();
  app.disable("x-powered-by");
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Content-Security-Policy", "default-src 'self'");
    next();
  });
  app.use("/api", (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  app.use(express.json({ limit: "16kb" }));
  registerRoutes(app, sessions);

  const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../public");
  app.use(express.static(publicDir));
  app.use((req, res) => {
    if (req.path.startsWith("/api/")) {
      res.status(404).json({ error: "No encontrado" });
      return;
    }
    res.status(404).type("text").send("No encontrado");
  });

  return {
    app,
    store,
    sessions,
    close: () => sessions.close(),
  };
}
