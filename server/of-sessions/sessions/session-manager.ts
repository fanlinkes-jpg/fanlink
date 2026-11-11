import { randomBytes } from "node:crypto";
import { chmod, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { BrowserContext, Page } from "playwright";
import type { DisplayEnv, FanlinkConfig } from "../config.ts";
import {
  decryptBytes,
  SessionCryptoError,
  writeEncryptedSession,
} from "../crypto.ts";
import {
  identityFailureReason,
  identityFromDom,
  identityFromMenu,
  identityFromStateCandidates,
  isCurrentUserResponseUrl,
  isLoginChallengeUrl,
  usersMeVerdict,
  jsonUrlWithoutSecrets,
  judgeIdentityMatch,
  readPageSignals,
  type IdentityNotes,
  type ReadIdentity,
} from "../identity.ts";
import { messages, publicErrorMessage } from "../messages.ts";
import { liveHoldsAccount } from "../live/hold.ts";
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
import { openWorkPage } from "./work-page.ts";
import { closeIfIdle } from "../live/pages.ts";
import { readAccountProxy } from "../proxy.ts";
import { preparePrivateDir } from "./private-dir.ts";
import type { SiteAdapter } from "./site.ts";
import { hasLiveCookies } from "./site.ts";
import { collectCreatorRead, type CollectedRead } from "../sync/collect.ts";
import type { TxCursor } from "../sync/parse.ts";
import { fetchSignedChats } from "../sync/of-chat-api.ts";
import { collectChats, type CollectedChats } from "../sync/collect-chats.ts";
import { collectNotifications, type CollectedNotifications } from "../sync/collect-notifications.ts";
import { NOTIFICATION_PACE_MS, notificationReadBusy } from "../../../src/lib/notifications.ts";
import {
  judgeStorageState,
  parseStorageState,
  type StorageCookie,
  type StorageStateFile,
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
  private readonly profileUsers = new Map<string, { context: BrowserContext; users: number }>();
  private readonly profileWait = new Map<string, Promise<void>>();
  private background: ManagedBrowser | null = null;
  private readTail: Promise<void> = Promise.resolve();
  private readonly reading = new Set<string>();
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

  /**
   * Comprueba la sesión guardada contra el sitio sin convertir ese resultado
   * en el estado de cookies. La identidad sale de lo que la página ya pide
   * o ya muestra, y se compara con el handle de la ficha.
   */
  async inspectConnection(accountId: string, expectedHandle = ""): Promise<Account> {
    assertAccountId(accountId);
    await this.options.store.get(accountId);
    const now = this.now().toISOString();
    const emptyIdentity = {
      identityState: "unavailable" as const,
      identityLabel: null,
      identityHandle: null,
      identityName: null,
      identityUserId: null,
      identityCheckedAt: now,
      identityReason: null,
    };
    const verdict = await this.localVerdict(accountId);
    if (verdict !== "valid") {
      return this.options.store.update(accountId, {
        connection: "rejected",
        ...emptyIdentity,
        lastCheckedAt: now,
        lastError: verdict === "missing" ? messages.noSession : messages.cookiesExpired,
      });
    }
    try {
      const outcome = await this.readProbe(accountId, expectedHandle);
      const loginRequired = outcome.connection === "login_required";
      return this.options.store.update(accountId, {
        connection: outcome.connection,
        ...(loginRequired ? { status: "expired" as const, sessionRejected: true } : {}),
        identityState: outcome.identityState,
        identityLabel: outcome.identityLabel,
        identityHandle: outcome.identityHandle,
        identityName: outcome.identityName,
        identityUserId: outcome.identityUserId,
        identityCheckedAt: now,
        identityReason: outcome.identityReason,
        lastCheckedAt: now,
        lastError: outcome.error,
      });
    } catch (error) {
      const message = publicErrorMessage(error, messages.internal);
      const inconclusive = message === messages.inconclusive;
      return this.options.store.update(accountId, {
        connection: inconclusive ? "inconclusive" : "rejected",
        ...emptyIdentity,
        lastCheckedAt: now,
        lastError: message,
      });
    }
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
  private async acquireProfile(accountId: string): Promise<BrowserContext> {
    for (;;) {
      const held = this.profileUsers.get(accountId);
      if (held) {
        held.users += 1;
        return held.context;
      }
      const pending = this.profileWait.get(accountId);
      if (pending) {
        await pending;
        continue;
      }
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      this.profileWait.set(accountId, gate);
      try {
        const context = await this.newRestoredContext(accountId);
        this.profileUsers.set(accountId, { context, users: 1 });
        return context;
      } finally {
        this.profileWait.delete(accountId);
        release();
      }
    }
  }

  private async releaseProfile(accountId: string): Promise<void> {
    const held = this.profileUsers.get(accountId);
    if (!held) return;
    held.users -= 1;
    if (held.users > 0) return;
    this.profileUsers.delete(accountId);
    this.openContexts.delete(held.context);
    await held.context.close().catch(() => undefined);
  }

  async withSession<T>(
    accountId: string,
    run: (context: BrowserContext) => Promise<T>,
  ): Promise<T> {
    const borrowed = await this.borrowProfile(accountId);
    try {
      return await run(borrowed.context);
    } finally {
      await borrowed.release();
    }
  }

  /** El mismo perfil persistente, sin abrir otro Chromium. Quien llama suelta el perfil. */
  async borrowProfile(accountId: string): Promise<{ context: BrowserContext; release: () => Promise<void> }> {
    await this.assertUsable(accountId);
    const context = await this.acquireProfile(accountId);
    let released = false;
    return {
      context,
      release: async () => {
        if (released) return;
        released = true;
        await this.releaseProfile(accountId);
      },
    };
  }

  /**
   * Una cuenta cada vez. No sincroniza si la identidad no coincide.
   * `includeEarnings` lo decide el servidor: un chatter no abre la página de ingresos.
   */
  readingIds(): string[] {
    return [...this.reading];
  }

  /** La cookie sigue en disco, pero OnlyFans ha pedido login. */
  async markLoginRequired(accountId: string): Promise<Account> {
    const now = this.now().toISOString();
    return this.options.store.update(accountId, {
      status: "expired",
      connection: "login_required",
      sessionRejected: true,
      identityState: "unavailable",
      identityLabel: null,
      identityHandle: null,
      identityName: null,
      identityUserId: null,
      identityCheckedAt: now,
      identityReason: messages.loginRequired,
      lastCheckedAt: now,
      lastError: messages.loginRequired,
    });
  }

  readCreatorData(accountId: string, includeEarnings: boolean, sinceTx?: TxCursor | null): Promise<CollectedRead> {
    if (liveHoldsAccount(accountId) || this.reading.size > 0) {
      return Promise.resolve({
        earnings: [],
        fans: [],
        transactions: [],
        reason: "sincronización en curso",
        jsonPaths: [],
        earningsCaptured: false,
        fansCaptured: false,
        alreadyRunning: true,
      });
    }
    this.reading.add(accountId);
    const job = this.readTail
      .then(() => this.readCreatorDataNow(accountId, includeEarnings, sinceTx))
      .finally(() => {
        this.reading.delete(accountId);
      });
    this.readTail = job.then(
      () => undefined,
      () => undefined,
    );
    return job;
  }

  /** Una lectura a la vez, el mismo perfil que la sincronización. */
  runQueued<T>(accountId: string, run: (context: BrowserContext) => Promise<T>, options?: { wait?: boolean }): Promise<{ ok: true; value: T } | { ok: false; busy: true }> {
    if (liveHoldsAccount(accountId)) return Promise.resolve({ ok: false, busy: true });
    if (!options?.wait && this.reading.size > 0) return Promise.resolve({ ok: false, busy: true });
    this.reading.add(accountId);
    const job = this.readTail.then(async () => {
      const value = await this.withSession(accountId, run);
      return { ok: true as const, value };
    }).finally(() => {
      this.reading.delete(accountId);
    });
    this.readTail = job.then(
      () => undefined,
      () => undefined,
    );
    return job;
  }

  readCreatorChats(accountId: string): Promise<CollectedChats> {
    const busy: CollectedChats = {
      threads: [],
      messages: [],
      reason: "sincronización en curso",
      jsonPaths: [],
      alreadyRunning: true,
    };
    if (liveHoldsAccount(accountId) || this.reading.size > 0) return Promise.resolve(busy);
    this.reading.add(accountId);
    const job = this.readTail.then(() => this.readChatsNow(accountId)).finally(() => {
      this.reading.delete(accountId);
    });
    this.readTail = job.then(
      () => undefined,
      () => undefined,
    );
    return job;
  }

  readNotifications(accountId: string): Promise<CollectedNotifications> {
    const busy: CollectedNotifications = {
      items: [],
      reason: "sincronización en curso",
      jsonPaths: [],
      captured: false,
      alreadyRunning: true,
    };
    if (liveHoldsAccount(accountId) || notificationReadBusy([...this.reading], accountId)) return Promise.resolve(busy);
    this.reading.add(accountId);
    const job = this.readTail.then(() => this.readNotificationsNow(accountId)).finally(() => {
      this.reading.delete(accountId);
    });
    this.readTail = job.then(
      () => undefined,
      () => undefined,
    );
    return job;
  }

  /** Mantiene el perfil abierto para escuchar. No entra en la cola: si lo hiciera, la bóveda esperaría mientras el chat sigue abierto. */
  holdWatch(accountId: string, run: (context: BrowserContext) => Promise<void>): Promise<boolean> {
    if (liveHoldsAccount(accountId)) return Promise.resolve(false);
    return this.readTail.then(async () => {
      if (this.reading.size > 0) return false;
      this.reading.add(accountId);
      try {
        await this.withSession(accountId, run);
        return true;
      } finally {
        this.reading.delete(accountId);
      }
    });
  }

  private async readNotificationsNow(accountId: string): Promise<CollectedNotifications> {
    const empty: CollectedNotifications = { items: [], reason: null, jsonPaths: [], captured: false };
    const account = await this.options.store.get(accountId);
    if (account.identityState === "mismatch") {
      return { ...empty, reason: "Lecturas bloqueadas: la sesión guardada es de otra cuenta." };
    }
    try {
      return await this.withSession(accountId, (context) =>
        collectNotifications(context, this.options.site, {
          paceMs: NOTIFICATION_PACE_MS,
          waitMs: this.options.config.identityWaitMs,
          scrolls: 1,
        }),
      );
    } catch (error) {
      return { ...empty, reason: publicErrorMessage(error, "no se pudo abrir la sesión") };
    }
  }

  /** Lee la lista de chats por HTTP con la sesión guardada. No abre Chromium. */
  async readChatsDirect(accountId: string): Promise<CollectedChats> {
    const empty: CollectedChats = { threads: [], messages: [], reason: null, jsonPaths: ["api2/v2/chats"] };
    try {
      const state = await this.readStorageState(accountId);
      const read = await fetchSignedChats(state, { fetch, now: () => this.now().getTime() });
      return { ...empty, threads: read.threads, messages: read.messages, reason: read.reason };
    } catch (error) {
      return { ...empty, reason: publicErrorMessage(error, "no se pudo leer la sesión") };
    }
  }

  private async readChatsNow(accountId: string): Promise<CollectedChats> {
    const empty: CollectedChats = { threads: [], messages: [], reason: null, jsonPaths: [] };
    const account = await this.options.store.get(accountId);
    if (account.identityState === "mismatch") {
      return { ...empty, reason: "Lecturas bloqueadas: la sesión guardada es de otra cuenta." };
    }
    try {
      const direct = await this.readChatsDirect(accountId);
      if (direct.threads.length > 0) return direct;
      return await this.withSession(accountId, (context) =>
        collectChats(context, this.options.site, {
          paceMs: this.options.config.syncPaceMs,
          waitMs: this.options.config.identityWaitMs,
        }),
      );
    } catch (error) {
      return { ...empty, reason: publicErrorMessage(error, "no se pudo abrir la sesión") };
    }
  }

  private async readCreatorDataNow(accountId: string, includeEarnings: boolean, sinceTx?: TxCursor | null): Promise<CollectedRead> {
    const empty: CollectedRead = {
      earnings: [],
      fans: [],
      transactions: [],
      reason: null,
      jsonPaths: [],
      earningsCaptured: false,
      fansCaptured: false,
    };
    const account = await this.options.store.get(accountId);
    if (account.identityState === "mismatch") {
      return { ...empty, reason: "Lecturas bloqueadas: la sesión guardada es de otra cuenta." };
    }
    try {
      return await this.withSession(accountId, (context) =>
        collectCreatorRead(context, this.options.site, {
          paceMs: this.options.config.syncPaceMs,
          waitMs: this.options.config.identityWaitMs,
          includeEarnings,
          now: this.now(),
          sinceTx,
        }),
      );
    } catch (error) {
      return { ...empty, reason: publicErrorMessage(error, "no se pudo abrir la sesión") };
    }
  }

  async sessionFetch(
    accountId: string,
    url: string,
  ): Promise<SessionFetchResult> {
    this.options.site.assertRequestUrl(url);
    try {
      const result = await this.withSession(accountId, async (context) => {
        const page = await openWorkPage(context);
        try {
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
        } finally {
          await closeIfIdle(page);
        }
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
    this.profileUsers.clear();
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
      const { interruptLiveAccount } = await import("../live/room.ts");
      await interruptLiveAccount(accountId);
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
          proxy: await this.accountProxy(accountId),
        },
      );
      await chmod(profileDir, 0o700);
      this.openContexts.add(context);
      if (this.closed) {
        await this.options.store.update(accountId, { loginInProgress: false });
        return;
      }
      const page = context.pages()[0] ?? (await context.newPage());
      let sawLoggedInUser = false;
      const loginPending: Promise<void>[] = [];
      context.on("response", (response) => {
        loginPending.push(
          (async () => {
            if (!isCurrentUserResponseUrl(response.url())) return;
            try {
              const verdict = usersMeVerdict(JSON.parse(await response.text()) as unknown);
              if (verdict.kind === "logged_in") sawLoggedInUser = true;
              if (verdict.kind === "guest") sawLoggedInUser = false;
            } catch {
              // Una respuesta que no es el usuario actual no decide el login.
            }
          })(),
        );
      });
      await page.goto(this.options.site.loginUrl, {
        waitUntil: "domcontentloaded",
        timeout: this.options.config.probeTimeoutMs,
      });
      this.log.info(`login window opened account=${accountId}`);
      if (this.options.afterLoginPageOpen) {
        await this.options.afterLoginPageOpen(page, accountId);
      }
      const dashboard = await this.waitForDashboard(context, () => sawLoggedInUser, loginPending);
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

  private async waitForDashboard(
    context: BrowserContext,
    loggedIn: () => boolean,
    pending: Promise<void>[],
  ): Promise<Page> {
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
          if (await this.pageHasSession(page, loggedIn, pending)) return page;
        } catch {
          // La página puede estar navegando. Se reintenta.
        }
      }
      await delay(250);
    }
    throw new Error(messages.loginTimeout);
  }

  private async pageHasSession(
    page: Page,
    loggedIn: () => boolean,
    pending: Promise<void>[],
  ): Promise<boolean> {
    await drain(pending);
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
    if (this.options.site.id === "onlyfans" && !loggedIn()) return false;
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

  private async readProbe(
    accountId: string,
    expectedHandle: string,
  ): Promise<{
    connection: "live" | "rejected" | "inconclusive" | "login_required";
    identityState: "unavailable" | "verified" | "mismatch";
    identityLabel: string | null;
    identityHandle: string | null;
    identityName: string | null;
    identityUserId: string | null;
    identityReason: string | null;
    error: string | null;
  }> {
    const context = await this.acquireProfile(accountId);
    const notes: IdentityNotes & { identities: ReadIdentity[] } = {
      identities: [],
      jsonPaths: [],
      sawUsersMe: false,
      usersMeUnreadable: false,
      usersMeMissingUsername: false,
      redirectedToLogin: false,
      guest: false,
      sawLoginChallenge: false,
    };
    const pending: Promise<void>[] = [];
    const onResponse = (response: { url(): string; headers(): Record<string, string>; text(): Promise<string> }) => {
      pending.push(this.observeResponse(response, notes));
    };
    context.on("response", onResponse);
    const blank = {
      identityState: "unavailable" as const,
      identityLabel: null,
      identityHandle: null,
      identityName: null,
      identityUserId: null,
      identityReason: null as string | null,
    };
    let page: Page | undefined;
    try {
      page = await openWorkPage(context);
      const first = await this.watchNavigation(page, this.options.site.probeUrl, notes, pending);
      if (this.options.site.isInconclusiveUrl?.(first.finalUrl)) {
        return { connection: "inconclusive", ...blank, identityReason: "no concluyente", error: messages.inconclusive };
      }
      const cookies = mapCookies(await context.cookies());
      const loginFormVisible = await this.loginFormVisible(page);
      if (loginFormVisible || this.options.site.isLoginUrl(first.finalUrl)) notes.redirectedToLogin = true;
      if (this.sessionNeedsLogin(notes, loginFormVisible)) {
        this.logLoginRequired(notes);
        return {
          connection: "login_required",
          ...blank,
          identityReason: messages.loginRequired,
          error: messages.loginRequired,
        };
      }
      const alive = this.sessionLooksAlive(
        this.options.site.probeUrl,
        first.status,
        first.finalUrl,
        cookies,
        loginFormVisible,
      );
      if (!alive) {
        const identityReason = identityFailureReason(notes);
        console.info(`[fanlink:identidad] ${identityReason}`);
        return { connection: "rejected", ...blank, identityReason, error: messages.sessionInvalid };
      }
      let read: ReadIdentity | null = notes.identities[0] ?? null;
      if (!read?.username) read = await this.identitySignals(page);
      const profileUrl = this.options.site.profileUrl;
      if (!read?.username && profileUrl && profileUrl !== this.options.site.probeUrl) {
        try {
          await this.watchNavigation(page, profileUrl, notes, pending);
          if (this.options.site.isLoginUrl(page.url())) notes.redirectedToLogin = true;
          read = notes.identities[0] ?? (await this.identitySignals(page));
        } catch {
          // La home ya demostró la conexión. El perfil es solo un intento más.
        }
      }
      const identityState = judgeIdentityMatch(expectedHandle, read?.username ?? null);
      const identityReason = identityState === "unavailable" ? identityFailureReason(notes) : null;
      if (identityReason) console.info(`[fanlink:identidad] ${identityReason}`);
      return {
        connection: "live",
        identityState,
        identityHandle: read?.username ?? null,
        identityName: read?.name ?? null,
        identityUserId: read?.userId ?? null,
        identityLabel: read?.username ?? read?.name ?? null,
        identityReason,
        error: null,
      };
    } finally {
      context.off("response", onResponse);
      if (page) await closeIfIdle(page);
      await this.releaseProfile(accountId);
    }
  }

  private async watchNavigation(
    page: Page,
    url: string,
    notes: IdentityNotes & { identities: ReadIdentity[] },
    pending: Promise<void>[],
  ): Promise<{ status: number; finalUrl: string }> {
    const response = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: this.options.config.probeTimeoutMs,
    });
    const budget = this.options.config.identityWaitMs;
    await Promise.race([
      page.waitForLoadState("networkidle", { timeout: budget }).catch(() => undefined),
      delay(budget),
    ]);
    const deadline = Date.now() + budget;
    while (Date.now() < deadline && notes.identities.length === 0 && !notes.guest && !notes.sawLoginChallenge) {
      await delay(200);
      await drain(pending);
    }
    await drain(pending);
    return { status: response?.status() ?? 0, finalUrl: page.url() };
  }

  private async identitySignals(page: Page): Promise<ReadIdentity | null> {
    const signals = await page.evaluate(readPageSignals).catch(() => null);
    const fromState = signals ? identityFromStateCandidates(signals.candidates) : null;
    if (fromState?.username) return fromState;
    const selector = this.options.site.identitySelector;
    const node = selector ? page.locator(selector).first() : null;
    const present = node ? await node.count().catch(() => 0) : 0;
    const dom = node && present > 0
      ? {
          text: await node.innerText({ timeout: 1_000 }).catch(() => ""),
          username: await node.getAttribute("data-username", { timeout: 1_000 }).catch(() => null),
          userId: await node.getAttribute("data-user-id", { timeout: 1_000 }).catch(() => null),
        }
      : null;
    const fromDom = identityFromDom(selector, dom);
    if (fromDom?.username) return fromDom;
    if (signals) {
      const fromMenu = identityFromMenu(signals.menuHrefs, signals.menuHandles);
      if (fromMenu?.username) return fromMenu;
    }
    return fromDom;
  }

  private async observeResponse(
    response: { url(): string; headers(): Record<string, string>; text(): Promise<string> },
    notes: IdentityNotes & { identities: ReadIdentity[] },
  ): Promise<void> {
    let url = "";
    try {
      url = response.url();
      const type = (response.headers()["content-type"] ?? "").toLowerCase();
      const usersMe = isCurrentUserResponseUrl(url);
      const jsonPath = jsonUrlWithoutSecrets(url);
      if (jsonPath && (type.includes("json") || usersMe) && !notes.jsonPaths.includes(jsonPath) && notes.jsonPaths.length < 20) {
        notes.jsonPaths.push(jsonPath);
      }
      if (isLoginChallengeUrl(url)) notes.sawLoginChallenge = true;
      if (!usersMe) return;
      notes.sawUsersMe = true;
      if (type && !type.includes("json") && !type.includes("text") && !type.includes("javascript")) {
        notes.usersMeUnreadable = true;
        return;
      }
      const raw = await response.text();
      if (raw.length > 1_500_000) {
        notes.usersMeUnreadable = true;
        return;
      }
      const verdict = usersMeVerdict(JSON.parse(raw) as unknown);
      if (verdict.kind === "guest") {
        notes.guest = true;
        notes.usersMeMissingUsername = true;
        notes.identities.splice(0, notes.identities.length);
        return;
      }
      if (verdict.kind !== "logged_in") {
        notes.usersMeMissingUsername = true;
        return;
      }
      notes.guest = false;
      notes.identities.push(verdict.identity);
    } catch {
      if (url && isCurrentUserResponseUrl(url)) notes.usersMeUnreadable = true;
    }
  }

  private sessionNeedsLogin(
    notes: IdentityNotes & { identities: ReadIdentity[] },
    loginFormVisible: boolean,
  ): boolean {
    if (this.options.site.id !== "onlyfans") return false;
    return notes.redirectedToLogin || notes.guest || notes.sawLoginChallenge || loginFormVisible || notes.identities.length === 0;
  }

  private logLoginRequired(notes: IdentityNotes): void {
    const paths = notes.jsonPaths.join(", ");
    console.info(`[fanlink:identidad] ${messages.loginRequired}${paths ? ` | json: ${paths}` : ""}`);
  }

  /**
   * Comprobar, sincronizar y chats reabren el perfil de Conectar
   * (`data/profiles/<cuenta>`), con la misma huella y el mismo modo
   * headless. Si ese perfil no existe, se restaura el storage state
   * cifrado en un contexto con esa misma huella.
   */
  private async newRestoredContext(accountId: string): Promise<BrowserContext> {
    const profile = this.profileDir(accountId);
    try {
      const info = await stat(profile);
      if (info.isDirectory()) {
        const headless = this.options.config.headlessWork;
        const proxy = await this.accountProxy(accountId);
        console.info(`[fanlink:navegador] perfil=${accountId} headless=${String(headless)} proxy=${proxy ? "si" : "no"}`);
        const context = await this.options.browsers.launchPersistentContext(profile, {
          headless,
          proxy,
        });
        await this.seedPersistentProfile(context, accountId);
        this.openContexts.add(context);
        return context;
      }
    } catch {
      // Perfil ausente: se usa el JSON cifrado.
    }
    const browser = await this.backgroundBrowser();
    const plainPath = await this.materializePlainStorage(accountId);
    try {
      const context = await browser.newContext({ storageState: plainPath, proxy: await this.accountProxy(accountId) });
      this.openContexts.add(context);
      return context;
    } finally {
      await rm(plainPath, { force: true });
    }
  }

  /**
   * El perfil guarda IndexedDB y las cookies con caducidad. Las de sesión
   * se pierden al cerrar Chromium, así que se reponen desde el JSON cifrado
   * solo si el perfil no las tiene ya. No se pisan las del perfil.
   */
  private async seedPersistentProfile(context: BrowserContext, accountId: string): Promise<void> {
    const encrypted = await readFile(this.storagePath(accountId));
    const state = parseStorageState(
      JSON.parse(decryptBytes(encrypted, this.requireSessionKey()).toString("utf8")) as unknown,
    );
    const present = await context.cookies();
    const known = new Set(present.map((cookie) => `${cookie.name}\n${cookie.domain}\n${cookie.path}`));
    const missing = state.cookies.filter((cookie) => !known.has(`${cookie.name}\n${cookie.domain}\n${cookie.path}`));
    if (missing.length > 0) await context.addCookies(missing);
    if (state.origins.length === 0) return;
    await context.addInitScript((origins) => {
      const match = origins.find((item) => item.origin === location.origin);
      if (!match) return;
      for (const entry of match.localStorage) {
        if (localStorage.getItem(entry.name) == null) localStorage.setItem(entry.name, entry.value);
      }
    }, state.origins);
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

  async readStorageState(accountId: string): Promise<StorageStateFile> {
    const raw = await readFile(this.storagePath(accountId));
    return parseStorageState(JSON.parse(decryptBytes(raw, this.requireSessionKey()).toString("utf8")) as unknown);
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

  private async accountProxy(accountId: string) {
    const key = this.options.config.sessionKey;
    if (!key) return null;
    const stored = await readAccountProxy(path.join(this.options.config.dataDir, "proxies", `${accountId}.bin`), key);
    if (!stored) return null;
    return {
      server: stored.server,
      ...(stored.username ? { username: stored.username } : {}),
      ...(stored.password ? { password: stored.password } : {}),
    };
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

async function drain(pending: Promise<void>[]): Promise<void> {
  for (let turn = 0; turn < 5 && pending.length > 0; turn += 1) {
    const batch = pending.splice(0, pending.length);
    await Promise.all(batch);
  }
}

function isNotFound(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "ENOENT",
  );
}
