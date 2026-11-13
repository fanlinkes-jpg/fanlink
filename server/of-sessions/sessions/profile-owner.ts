import type { BrowserContext } from "playwright";
import { messages } from "../messages.ts";

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
  private readonly hooks: ProfileHooks;

  constructor(hooks: ProfileHooks) {
    this.hooks = hooks;
  }

  /** El mismo contexto si la cuenta ya lo tiene abierto. Si no, lo lanza. */
  async lease(accountId: string): Promise<ProfileLease> {
    for (;;) {
      if (this.hooks.isStopped()) throw new Error(messages.loginCancelled);
      const slot = await this.withLock(accountId, async () => {
        const current = this.slots.get(accountId);
        if (current?.exclusive) return null;
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
        };
        this.slots.set(accountId, created);
        return created;
      });
      if (slot) return this.hand(accountId, slot);
      await (this.loginGates.get(accountId) ?? Promise.resolve());
    }
  }

  /**
   * Conectar / Reconectar. Cierra limpio quien tuviera el perfil (la sala
   * ya se soltó antes) y abre la ventana de login. El cierre y el lanzamiento
   * van dentro del cerrojo, así que no coinciden dos Chromium.
   */
  async login(accountId: string): Promise<ProfileLease> {
    this.armLoginGate(accountId);
    try {
      const slot = await this.withLock(accountId, async () => {
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
        };
        this.slots.set(accountId, created);
        return created;
      });
      return this.hand(accountId, slot);
    } catch (error) {
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
      await this.hooks.persist(accountId, current.context).catch(() => undefined);
      const again = this.slots.get(accountId);
      if (!again || again.token !== token) return;
      again.users -= 1;
      if (again.users > 0) return;
      exclusive = again.exclusive;
      this.slots.delete(accountId);
      await this.hooks.closeContext(again.context);
    });
    if (exclusive) this.finishLoginGate(accountId);
  }

  /** Suelta el contexto actual y guarda sus cookies antes de cerrarlo. */
  private async dropSlot(accountId: string): Promise<void> {
    const current = this.slots.get(accountId);
    if (!current) return;
    this.slots.delete(accountId);
    await this.hooks.persist(accountId, current.context).catch(() => undefined);
    await this.hooks.closeContext(current.context);
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
