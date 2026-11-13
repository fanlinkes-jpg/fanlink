import type { BrowserContext } from "playwright";
import { messages } from "../messages.ts";
import { SessionPendingError } from "../types.ts";

/**
 * Un solo Chromium por cuenta. Login, sala, escucha, sincronización, bóveda,
 * fans en línea, menú del fan y envío piden el perfil aquí. El cerrojo cubre
 * el lanzamiento: no hay dos contextos vivos sobre el mismo directorio.
 */
type Slot = {
  context: BrowserContext;
  users: number;
  token: symbol;
  /** La ventana de Conectar no se comparte con una lectura. */
  exclusive: boolean;
  /** Hay un login esperando a que las lecturas suelten el perfil. No se cierra todavía. */
  yielding: boolean;
};

export type ProfileLease = {
  context: BrowserContext;
  release: () => Promise<void>;
};

export type ProfileHooks = {
  openShared: (accountId: string) => Promise<BrowserContext>;
  openExclusive: (accountId: string) => Promise<BrowserContext>;
  persist: (accountId: string, context: BrowserContext) => Promise<void>;
  closeContext: (context: BrowserContext) => Promise<void>;
  isStopped: () => boolean;
};

export class ProfileOwner {
  private readonly slots = new Map<string, Slot>();
  private readonly chains = new Map<string, Promise<void>>();
  private readonly loginGates = new Map<string, Promise<void>>();
  private readonly loginRelease = new Map<string, () => void>();
  private readonly idle = new Map<string, () => void>();
  private readonly hooks: ProfileHooks;

  constructor(hooks: ProfileHooks) {
    this.hooks = hooks;
  }

  /**
   * El mismo contexto si la cuenta ya lo tiene abierto. Si Conectar lo tiene,
   * o está esperando a las lecturas, no se queda esperando: la lectura recibe
   * un error y puede decirlo.
   */
  async lease(accountId: string): Promise<ProfileLease> {
    if (this.hooks.isStopped()) throw new Error(messages.loginCancelled);
    const slot = await this.withLock(accountId, async () => {
      const current = this.slots.get(accountId);
      if (current?.exclusive || current?.yielding) {
        throw new SessionPendingError(messages.loginInProgress);
      }
      if (current) {
        current.users += 1;
        return current;
      }
      const context = await this.hooks.openShared(accountId);
      if (this.hooks.isStopped()) {
        await this.hooks.closeContext(context);
        throw new Error(messages.loginCancelled);
      }
      const created: Slot = {
        context,
        users: 1,
        token: Symbol(accountId),
        exclusive: false,
        yielding: false,
      };
      this.slots.set(accountId, created);
      return created;
    });
    return this.hand(accountId, slot);
  }

  /**
   * Conectar / Reconectar. No cierra el navegador mientras haya lecturas:
   * espera a que suelten el perfil y, hasta entonces, las nuevas reciben
   * un error. El cierre y el lanzamiento van dentro del cerrojo.
   */
  async login(accountId: string): Promise<ProfileLease> {
    this.armLoginGate(accountId);
    try {
      for (;;) {
        if (this.hooks.isStopped()) throw new Error(messages.loginCancelled);
        await this.withLock(accountId, async () => {
          const current = this.slots.get(accountId);
          if (current && !current.exclusive) current.yielding = true;
        });
        await this.waitUntilIdle(accountId, profileIdleMs());
        const opened = await this.withLock(accountId, async () => {
          const current = this.slots.get(accountId);
          if (current && current.users > 0) return null;
          await this.dropSlot(accountId);
          const context = await this.hooks.openExclusive(accountId);
          if (this.hooks.isStopped()) {
            await this.hooks.closeContext(context);
            throw new Error(messages.loginCancelled);
          }
          const created: Slot = {
            context,
            users: 1,
            token: Symbol(accountId),
            exclusive: true,
            yielding: false,
          };
          this.slots.set(accountId, created);
          return created;
        });
        if (opened) return this.hand(accountId, opened);
      }
    } catch (error) {
      await this.clearYield(accountId);
      this.finishLoginGate(accountId);
      throw error;
    }
  }

  stop(): void {
    for (const accountId of this.loginRelease.keys()) this.finishLoginGate(accountId);
  }

  async closeAll(): Promise<void> {
    for (const accountId of [...this.slots.keys()]) {
      await this.withLock(accountId, async () => {
        const current = this.slots.get(accountId);
        if (current) current.users = 0;
        await this.dropSlot(accountId);
      });
      this.finishLoginGate(accountId);
    }
  }

  private hand(accountId: string, slot: Slot): ProfileLease {
    const token = slot.token;
    let released = false;
    return {
      context: slot.context,
      release: async () => {
        if (released) return;
        released = true;
        await this.release(accountId, token);
      },
    };
  }

  private async release(accountId: string, token: symbol): Promise<void> {
    let exclusive = false;
    await this.withLock(accountId, async () => {
      const current = this.slots.get(accountId);
      if (!current || current.token !== token) return;
      await this.saveProfile(accountId, current.context);
      const again = this.slots.get(accountId);
      if (!again || again.token !== token) return;
      again.users -= 1;
      if (again.users > 0) return;
      if (again.yielding && !again.exclusive) {
        this.notifyIdle(accountId);
        return;
      }
      exclusive = again.exclusive;
      this.slots.delete(accountId);
      this.notifyIdle(accountId);
      await this.hooks.closeContext(again.context);
    });
    if (exclusive) this.finishLoginGate(accountId);
  }

  /**
   * Cierra el contexto solo cuando ya no hay lecturas. Quien llama
   * (el login) espera antes a `users === 0`.
   */
  private async dropSlot(accountId: string): Promise<void> {
    const current = this.slots.get(accountId);
    if (!current) return;
    if (current.users > 0) {
      throw new SessionPendingError(messages.loginInProgress);
    }
    this.slots.delete(accountId);
    this.notifyIdle(accountId);
    await this.saveProfile(accountId, current.context);
    await this.hooks.closeContext(current.context);
  }

  private async saveProfile(accountId: string, context: BrowserContext): Promise<void> {
    try {
      await this.hooks.persist(accountId, context);
    } catch (error) {
      const kind = error instanceof Error ? error.name : "error";
      console.warn(`[fanlink:perfil] no se pudo guardar la sesión cuenta=${accountId} tipo=${kind}`);
    }
  }

  private async waitUntilIdle(accountId: string, timeoutMs: number): Promise<void> {
    const boxed = await this.withLock(accountId, async () => {
      const slot = this.slots.get(accountId);
      if (!slot || slot.users === 0) return null;
      let resolve: () => void = () => undefined;
      const gate = new Promise<void>((done) => {
        resolve = done;
      });
      this.idle.set(accountId, resolve);
      return { gate };
    });
    if (!boxed) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timed = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), timeoutMs);
    });
    const outcome = await Promise.race([boxed.gate.then(() => "idle" as const), timed]);
    if (timer) clearTimeout(timer);
    if (outcome === "idle") return;
    this.notifyIdle(accountId);
    throw new SessionPendingError("El perfil sigue ocupado. No se ha abierto Conectar.");
  }

  private notifyIdle(accountId: string): void {
    const notify = this.idle.get(accountId);
    this.idle.delete(accountId);
    notify?.();
  }

  private async clearYield(accountId: string): Promise<void> {
    await this.withLock(accountId, async () => {
      const current = this.slots.get(accountId);
      if (!current?.yielding || current.exclusive) return;
      current.yielding = false;
      if (current.users === 0) await this.dropSlot(accountId);
    }).catch(() => undefined);
  }

  private armLoginGate(accountId: string): void {
    if (this.loginRelease.has(accountId)) return;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.loginGates.set(accountId, gate);
    this.loginRelease.set(accountId, release);
  }

  private finishLoginGate(accountId: string): void {
    const release = this.loginRelease.get(accountId);
    this.loginRelease.delete(accountId);
    this.loginGates.delete(accountId);
    release?.();
  }

  private async withLock<T>(accountId: string, run: () => Promise<T>): Promise<T> {
    const previous = this.chains.get(accountId) ?? Promise.resolve();
    let unlock: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    this.chains.set(
      accountId,
      previous.then(() => gate),
    );
    await previous;
    try {
      return await run();
    } finally {
      unlock();
    }
  }
}

/** Cuánto espera Reconectar a que las lecturas suelten el perfil. Por defecto 25 s. */
function profileIdleMs(): number {
  const value = Number(process.env.FANLINK_PROFILE_IDLE_MS);
  if (Number.isInteger(value) && value >= 100 && value <= 60_000) return value;
  return 25_000;
}
