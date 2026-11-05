import { chmod, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { Account, SessionStatus } from "../types.js";
import { AccountNotFoundError } from "../types.js";

interface AccountFile {
  version: 1;
  accounts: Account[];
}

export type AccountPatch = Partial<
  Pick<
    Account,
    | "label"
    | "status"
    | "loginInProgress"
    | "sessionRejected"
    | "hasStorageState"
    | "lastCheckedAt"
    | "lastError"
  >
>;

export class AccountStore {
  private accounts: Account[] = [];
  private tail: Promise<void> = Promise.resolve();

  constructor(
    private readonly filePath: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async init(): Promise<void> {
    await this.enqueue(async () => {
      await this.readFromDisk();
    });
  }

  async list(): Promise<Account[]> {
    return this.accounts.map((account) => ({ ...account }));
  }

  async get(id: string): Promise<Account> {
    const account = this.accounts.find((item) => item.id === id);
    if (!account) throw new AccountNotFoundError(id);
    return { ...account };
  }

  async create(label: string): Promise<Account> {
    return this.enqueue(async () => {
      const timestamp = this.now().toISOString();
      const account: Account = {
        id: randomUUID(),
        label,
        status: "pending_login",
        loginInProgress: false,
        sessionRejected: false,
        hasStorageState: false,
        createdAt: timestamp,
        updatedAt: timestamp,
        lastCheckedAt: null,
        lastError: null,
      };
      this.accounts.push(account);
      await this.persist();
      return { ...account };
    });
  }

  async update(id: string, patch: AccountPatch): Promise<Account> {
    return this.enqueue(async () => {
      const index = this.accounts.findIndex((item) => item.id === id);
      const current = index >= 0 ? this.accounts[index] : undefined;
      if (!current) throw new AccountNotFoundError(id);
      const next: Account = {
        ...current,
        ...patch,
        id: current.id,
        createdAt: current.createdAt,
        updatedAt: this.now().toISOString(),
      };
      this.accounts[index] = next;
      await this.persist();
      return { ...next };
    });
  }

  private async enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.tail.then(fn, fn);
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async readFromDisk(): Promise<void> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch (error) {
      if (isNotFound(error)) {
        this.accounts = [];
        return;
      }
      throw error;
    }
    const parsed = JSON.parse(raw) as Partial<AccountFile>;
    if (parsed.version !== 1 || !Array.isArray(parsed.accounts)) {
      throw new Error("accounts.json no es válido");
    }
    this.accounts = parsed.accounts.map((account) => normalizeAccount(account));
  }

  private async persist(): Promise<void> {
    const payload: AccountFile = { version: 1, accounts: this.accounts };
    const tmp = `${this.filePath}.${process.pid}.tmp`;
    await writeFile(tmp, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
    await rename(tmp, this.filePath);
    await chmod(this.filePath, 0o600);
  }
}

function normalizeAccount(account: Account): Account {
  const status: SessionStatus =
    account.status === "active" || account.status === "expired" || account.status === "pending_login"
      ? account.status
      : "pending_login";
  return {
    id: account.id,
    label: account.label,
    status,
    loginInProgress: Boolean(account.loginInProgress),
    sessionRejected: Boolean(account.sessionRejected),
    hasStorageState: Boolean(account.hasStorageState),
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
    lastCheckedAt: account.lastCheckedAt ?? null,
    lastError: account.lastError ?? null,
  };
}

function isNotFound(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}
