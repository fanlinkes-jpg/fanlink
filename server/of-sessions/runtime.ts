import path from "node:path";
import type { Page } from "playwright";
import type { DisplayEnv, FanlinkConfig } from "./config.ts";
import { currentDisplayEnv } from "./config.ts";
import {
  createPlaywrightFactory,
  type BrowserFactory,
} from "./sessions/browser-factory.ts";
import { preparePrivateDir } from "./sessions/private-dir.ts";
import { SessionManager } from "./sessions/session-manager.ts";
import type { SiteAdapter } from "./sessions/site.ts";
import { AccountStore } from "./store/account-store.ts";
import type { AccountRepository } from "./store/repository.ts";

export interface CreateRuntimeOptions {
  config: FanlinkConfig;
  site: SiteAdapter;
  browserFactory?: BrowserFactory;
  displayEnv?: DisplayEnv;
  now?: () => Date;
  afterLoginPageOpen?: (page: Page, accountId: string) => Promise<void> | void;
  logger?: { info(message: string): void; warn(message: string): void };
  store?: AccountRepository;
  fetch?: typeof fetch;
}

export async function createSessionRuntime(options: CreateRuntimeOptions) {
  await preparePrivateDir(options.config.dataDir);
  await preparePrivateDir(path.join(options.config.dataDir, "profiles"));
  await preparePrivateDir(path.join(options.config.dataDir, "sessions"));

  const store =
    options.store ??
    new AccountStore(
      path.join(options.config.dataDir, "accounts.json"),
      options.now,
    );
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
    fetch: options.fetch,
  });

  return {
    store,
    sessions,
    close: () => sessions.close(),
  };
}
