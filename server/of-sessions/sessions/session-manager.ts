import { randomBytes } from "node:crypto";
import { chmod, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { BrowserContext, Page } from "playwright";
import type { DisplayEnv, FanlinkConfig } from "../config.ts";
import {
  decryptBytes,
  SessionCryptoError,
  writeEncryptedSession,
} from "../crypto.ts";
import { messages, publicErrorMessage } from "../messages.ts";
import type { AccountRepository } from "../store/repository.ts";
import type { Account } from "../types.ts";
import {
  assertAccountId,
  parseCreatorId,
  SessionInvalidError,
  SessionPendingError,
} from "../types.ts";
import {
  explainLaunchError,
  type BrowserFactory,
  type ManagedBrowser,
} from "./browser-factory.ts";
import { assertLoginDisplay } from "./display.ts";
import { preparePrivateDir } from "./private-dir.ts";
import type { SiteAdapter } from "./site.ts";
import { hasLiveCookies } from "./site.ts";
import {
  judgeStorageState,
  parseStorageState,
  type StorageCookie,
} from "./storage-state.ts";

export interface SessionFetchResult {
  status: number;
  finalUrl: string;
  body: string;
}

export interface SessionManagerOptions {
  config: FanlinkConfig;
  store: AccountRepository;
  site: SiteAdapter;
  browsers: BrowserFactory;
  displayEnv: DisplayEnv;
  now?: () => Date;
  /**
   * Gancho de pruebas. En la app real no se usa: la persona escribe
   * usuario y contraseña en la ventana de OnlyFans.
   */
  afterLoginPageOpen?: (page: Page, accountId: string) => Promise<void> | void;
  logger?: { info(message: string): void; warn(message: string): void };
}

const silentLogger = { info() {}, warn() {} };

export class SessionManager {
  private readonly loginTasks = new Map<string, Promise<void>>();
  private readonly openContexts = new Set<BrowserContext>();
  private background: ManagedBrowser | null = null;
  private closed = false;
  private started = false;
  private readonly options: SessionManagerOptions;

  constructor(options: SessionManagerOptions) {
    this.options = options;
  }

  private get log() {
    return this.options.logger ?? silentLogger;
  }

  private get now() {
    return this.options.now ?? (() => new Date());
  }

  async addAccount(label: string, creatorId?: string | null): Promise<Account> {
    const account = await this.options.store.create(label, creatorId);
    this.startLogin(account.id);
    return this.options.store.get(account.id);
  }

  /**
   * Alta o reutilización de la sesión ligada a una creadora, sin abrir
   * la ventana. El acceso lo arranca beginInteractiveLogin.
   */
  async ensureAccount(label: string, creatorId: string): Promise<Account> {
    const linked = parseCreatorId(creatorId);
    const existing = await this.options.store.findByCreator(linked);
    if (!existing) return this.options.store.create(label, linked);
    if (existing.label !== label)
      return this.options.store.update(existing.id, { label });
    return existing;
  }

  /**
   * Al arrancar, cada cuenta con storage state se comprueba en un contexto
   * nuevo. Si OnlyFans ya no acepta la sesión, el indicador pasa a
   * pendiente y se reabre la ventana.
   */
  async startup(): Promise<void> {
    if (this.started) return;
    this.started = true;
    await this.recoverInterruptedLogins();
    const fresh = await this.options.store.list();
    for (const account of fresh) {
      await this.reconcileOnStartup(account.id);
    }
  }

  async listAccounts(): Promise<Account[]> {
    const accounts = await this.options.store.list();
    for (const account of accounts) {
      if (account.loginInProgress || account.status !== "active") continue;
      const verdict = await this.localVerdict(account.id);
      if (verdict === "expired") {
        await this.applyInvalidation(account.id, messages.cookiesExpired);
      } else if (verdict === "missing") {
        await this.options.store.update(account.id, {
          status: "pending_login",
          hasStorageState: false,
          sessionRejected: false,
          lastError: messages.noSession,
        });
      }
    }
    return this.options.store.list();
  }

  async getAccount(accountId: string): Promise<Account> {
    assertAccountId(accountId);
    return this.options.store.get(accountId);
  }

  async probe(accountId: string): Promise<Account> {
    try {
      await this.sessionFetch(accountId, this.options.site.probeUrl);
    } catch (error) {
      if (
        !(error instanceof SessionPendingError) &&
        !(error instanceof SessionInvalidError)
      ) {
        await this.options.store.update(accountId, {
          lastError: publicErrorMessage(error, messages.internal),
          lastCheckedAt: this.now().toISOString(),
        });
      }
    }
    return this.options.store.get(accountId);
  }

  async beginInteractiveLogin(accountId: string): Promise<Account> {
    assertAccountId(accountId);
    await this.options.store.get(accountId);
    this.startLogin(accountId);
    return this.options.store.get(accountId);
  }

  /**
   * Si el proceso se reinició con un login a medias, la ventana ya no está.
   * El indicador deja de decir que el acceso sigue en curso.
   */
  async recoverInterruptedLogins(): Promise<void> {
    const accounts = await this.options.store.list();
    for (const account of accounts) {
      if (account.loginInProgress && !this.loginTasks.has(account.id)) {
        await this.options.store.update(account.id, { loginInProgress: false });
      }
    }
  }

  whenLoginSettled(accountId: string): Promise<void> {
    return this.loginTasks.get(accountId) ?? Promise.resolve();
  }

  /**
   * Restaura el JSON de la cuenta en un contexto nuevo. No abre el
   * formulario ni rellena credenciales.
   */
  async withSession<T>(
    accountId: string,
    run: (context: BrowserContext) => Promise<T>,
  ): Promise<T> {
    await this.assertUsable(accountId);
    const context = await this.newRestoredContext(accountId);
    try {
      return await run(context);
    } finally {
      this.openContexts.delete(context);
      await context.close().catch(() => undefined);
    }
  }

  async sessionFetch(
    accountId: string,
    url: string,
  ): Promise<SessionFetchResult> {
    this.options.site.assertRequestUrl(url);
    try {
      const result = await this.withSession(accountId, async (context) => {
        const page = await context.newPage();
        const response = await page.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: this.options.config.probeTimeoutMs,
        });
        const finalUrl = page.url();
        if (this.options.site.isInconclusiveUrl?.(finalUrl)) {
          throw new Error(messages.inconclusive);
        }
        const cookies = mapCookies(await context.cookies());
        const status = response?.status() ?? 0;
        const loginFormVisible = await this.loginFormVisible(page);
        if (
          !this.sessionLooksAlive(
            url,
            status,
            finalUrl,
            cookies,
            loginFormVisible,
          )
        ) {
          throw new SessionInvalidError(messages.sessionInvalid);
        }
        const body = (await page.content()).slice(0, 200_000);
        return { status, finalUrl, body };
      });
      await this.options.store.update(accountId, {
        status: "active",
        sessionRejected: false,
        hasStorageState: true,
        lastError: null,
        lastCheckedAt: this.now().toISOString(),
      });
      return result;
    } catch (error) {
      if (error instanceof SessionInvalidError) {
        await this.applyInvalidation(accountId, error.message);
      }
      throw error;
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    const contexts = [...this.openContexts];
    this.openContexts.clear();
    await Promise.all(
      contexts.map((context) => context.close().catch(() => undefined)),
    );
    await Promise.allSettled([...this.loginTasks.values()]);
    if (this.background) {
      await this.background.close().catch(() => undefined);
      this.background = null;
    }
  }

  private async reconcileOnStartup(accountId: string): Promise<void> {
    const verdict = await this.localVerdict(accountId);
    if (verdict === "missing") {
      await this.options.store.update(accountId, {
        status: "pending_login",
        hasStorageState: false,
        loginInProgress: false,
      });
      return;
    }
    if (verdict === "expired") {
      await this.applyInvalidation(accountId, messages.cookiesExpired);
      return;
    }
    try {
      await this.sessionFetch(accountId, this.options.site.probeUrl);
    } catch (error) {
      if (
        error instanceof SessionPendingError ||
        error instanceof SessionInvalidError
      )
        return;
      await this.options.store.update(accountId, {
        lastError: publicErrorMessage(error, messages.internal),
        lastCheckedAt: this.now().toISOString(),
      });
    }
  }

  private async assertUsable(accountId: string): Promise<void> {
    assertAccountId(accountId);
    const account = await this.options.store.get(accountId);
    if (account.loginInProgress || this.loginTasks.has(accountId)) {
      throw new SessionPendingError(messages.loginInProgress);
    }
    const verdict = await this.localVerdict(accountId);
    if (verdict === "missing") {
      await this.options.store.update(accountId, {
        status: "pending_login",
        hasStorageState: false,
        lastError: messages.noSession,
      });
      if (this.options.config.openLoginOnInvalidate) this.startLogin(accountId);
      throw new SessionPendingError(messages.noSession);
    }
    if (verdict === "expired") {
      await this.applyInvalidation(accountId, messages.cookiesExpired);
      throw new SessionPendingError(messages.cookiesExpired);
    }
  }

  private async applyInvalidation(
    accountId: string,
    reason: string,
  ): Promise<void> {
    const loginAlreadyOpen = this.loginTasks.has(accountId);
    const reopen =
      this.options.config.openLoginOnInvalidate || loginAlreadyOpen;
    await this.options.store.update(accountId, {
      status: reopen ? "pending_login" : "expired",
      sessionRejected: true,
      loginInProgress: loginAlreadyOpen,
      lastError: reason,
      lastCheckedAt: this.now().toISOString(),
    });
    this.log.warn(`session invalidated account=${accountId}`);
    if (this.options.config.openLoginOnInvalidate) {
      this.startLogin(accountId);
    }
  }

  private startLogin(accountId: string): Promise<void> {
    const existing = this.loginTasks.get(accountId);
    if (existing) return existing;
    const task = this.runLogin(accountId).finally(() => {
      this.loginTasks.delete(accountId);
    });
    this.loginTasks.set(accountId, task);
    return task;
  }

  private async runLogin(accountId: string): Promise<void> {
    let context: BrowserContext | undefined;
    try {
      if (this.closed) return;
      await this.options.store.update(accountId, {
        status: "pending_login",
        loginInProgress: true,
      });
      const sessionKey = this.options.config.sessionKey;
      if (!sessionKey) throw new Error(messages.missingKey);
      assertLoginDisplay(
        this.options.config.headlessLogin,
        this.options.displayEnv,
      );
      const profileDir = this.profileDir(accountId);
      await preparePrivateDir(profileDir);
      context = await this.options.browsers.launchPersistentContext(
        profileDir,
        {
          headless: this.options.config.headlessLogin,
        },
      );
      await chmod(profileDir, 0o700);
      this.openContexts.add(context);
      if (this.closed) {
        await this.options.store.update(accountId, { loginInProgress: false });
        return;
      }
      const page = context.pages()[0] ?? (await context.newPage());
      await page.goto(this.options.site.loginUrl, {
        waitUntil: "domcontentloaded",
        timeout: this.options.config.probeTimeoutMs,
      });
      this.log.info(`login window opened account=${accountId}`);
      if (this.options.afterLoginPageOpen) {
        await this.options.afterLoginPageOpen(page, accountId);
      }
      const dashboard = await this.waitForDashboard(context);
      await dashboard
        .waitForLoadState("load", { timeout: 15_000 })
        .catch(() => undefined);
      const storagePath = this.storagePath(accountId);
      await preparePrivateDir(path.dirname(storagePath));
      const exportedState = parseStorageState(await context.storageState());
      await writeEncryptedSession(storagePath, exportedState, sessionKey);
      await this.options.store.update(accountId, {
        status: "active",
        loginInProgress: false,
        sessionRejected: false,
        hasStorageState: true,
        lastCheckedAt: this.now().toISOString(),
        lastError: null,
      });
      this.log.info(`session stored account=${accountId}`);
    } catch (error) {
      const explained = explainLaunchError(error);
      const account = await this.options.store.get(accountId).catch(() => null);
      const verdict = await this.localVerdict(accountId).catch(
        () => "missing" as const,
      );
      const rejected =
        Boolean(account?.sessionRejected) || verdict === "expired";
      await this.options.store.update(accountId, {
        status: rejected ? "expired" : "pending_login",
        loginInProgress: false,
        lastError: publicErrorMessage(explained, messages.loginClosed),
      });
      this.log.warn(`login failed account=${accountId}`);
    } finally {
      if (context) {
        this.openContexts.delete(context);
        await context.close().catch(() => undefined);
      }
    }
  }

  private async waitForDashboard(context: BrowserContext): Promise<Page> {
    const deadline = Date.now() + this.options.config.loginTimeoutMs;
    while (Date.now() < deadline) {
      if (this.closed) throw new Error(messages.loginCancelled);
      let pages: Page[];
      try {
        pages = context.pages();
      } catch {
        throw new Error(messages.loginClosed);
      }
      const openPages = pages.filter((page) => !page.isClosed());
      if (openPages.length === 0) throw new Error(messages.loginClosed);
      for (const page of openPages) {
        try {
          if (await this.pageHasSession(page)) return page;
        } catch {
          // La página puede estar navegando. Se reintenta.
        }
      }
      await delay(250);
    }
    throw new Error(messages.loginTimeout);
  }

  private async pageHasSession(page: Page): Promise<boolean> {
    const cookies = mapCookies(await page.context().cookies());
    if (
      !this.options.site.isAuthenticated(
        page.url(),
        cookies,
        this.now().getTime(),
      )
    )
      return false;
    if (await this.loginFormVisible(page)) return false;
    return true;
  }

  private async loginFormVisible(page: Page): Promise<boolean> {
    const selector = this.options.site.loggedOutSelector;
    if (!selector) return false;
    return (await page.locator(`${selector}:visible`).count()) > 0;
  }

  private sessionLooksAlive(
    requestedUrl: string,
    status: number,
    finalUrl: string,
    cookies: StorageCookie[],
    loginFormVisible: boolean,
  ): boolean {
    if (status === 401) return false;
    if (
      !this.options.site.isLoginUrl(requestedUrl) &&
      this.options.site.isLoginUrl(finalUrl)
    )
      return false;
    if (requestedUrl === this.options.site.probeUrl && loginFormVisible)
      return false;
    if (requestedUrl === this.options.site.probeUrl) {
      return this.options.site.isAuthenticated(
        finalUrl,
        cookies,
        this.now().getTime(),
      );
    }
    return hasLiveCookies(this.options.site, cookies, this.now().getTime());
  }

  private async newRestoredContext(accountId: string): Promise<BrowserContext> {
    const browser = await this.backgroundBrowser();
    const plainPath = await this.materializePlainStorage(accountId);
    try {
      const context = await browser.newContext({ storageState: plainPath });
      this.openContexts.add(context);
      return context;
    } finally {
      await rm(plainPath, { force: true });
    }
  }

  /** Playwright lee un JSON en claro. Se descifra a un archivo temporal y se borra al cargar el contexto. */
  private async materializePlainStorage(accountId: string): Promise<string> {
    const sessionKey = this.requireSessionKey();
    const encrypted = await readFile(this.storagePath(accountId));
    const plain = decryptBytes(encrypted, sessionKey);
    const tmp = path.join(
      path.dirname(this.storagePath(accountId)),
      `.${accountId}.${randomBytes(8).toString("hex")}.json`,
    );
    await writeFile(tmp, plain, { mode: 0o600 });
    await chmod(tmp, 0o600);
    return tmp;
  }

  private requireSessionKey(): Buffer {
    const sessionKey = this.options.config.sessionKey;
    if (!sessionKey) throw new SessionCryptoError(messages.missingKey);
    return sessionKey;
  }

  private async backgroundBrowser(): Promise<ManagedBrowser> {
    if (!this.background) {
      try {
        this.background = await this.options.browsers.launch();
      } catch (error) {
        throw explainLaunchError(error);
      }
    }
    return this.background;
  }

  private async localVerdict(
    accountId: string,
  ): Promise<"missing" | "valid" | "expired"> {
    const file = this.storagePath(accountId);
    let raw: Buffer;
    try {
      raw = await readFile(file);
    } catch (error) {
      if (isNotFound(error)) return "missing";
      throw error;
    }
    try {
      const state = parseStorageState(
        JSON.parse(
          decryptBytes(raw, this.requireSessionKey()).toString("utf8"),
        ) as unknown,
      );
      return judgeStorageState(
        state,
        this.options.site.requiredCookies,
        this.options.site.hostname,
        this.now().getTime(),
      );
    } catch (error) {
      if (error instanceof SessionCryptoError) throw error;
      return "expired";
    }
  }

  private profileDir(accountId: string): string {
    assertAccountId(accountId);
    return path.join(this.options.config.dataDir, "profiles", accountId);
  }

  private storagePath(accountId: string): string {
    assertAccountId(accountId);
    return path.join(
      this.options.config.dataDir,
      "sessions",
      `${accountId}.json`,
    );
  }
}

function mapCookies(
  cookies: Array<{
    name: string;
    value: string;
    domain: string;
    path: string;
    expires: number;
    httpOnly: boolean;
    secure: boolean;
    sameSite: "Strict" | "Lax" | "None";
  }>,
): StorageCookie[] {
  return cookies.map((cookie) => ({
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
    path: cookie.path,
    expires: cookie.expires,
    httpOnly: cookie.httpOnly,
    secure: cookie.secure,
    sameSite: cookie.sameSite,
  }));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isNotFound(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "ENOENT",
  );
}
