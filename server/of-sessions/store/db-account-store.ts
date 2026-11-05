import { randomUUID } from "node:crypto";
import type { AccountRepository } from "./repository.ts";
import type { Account, AccountPatch, SessionStatus } from "../types.ts";
import {
  AccountNotFoundError,
  InvalidArgumentError,
  parseCreatorId,
} from "../types.ts";

export interface SqlQuery {
  query<T = Record<string, unknown>>(
    text: string,
    params?: unknown[],
  ): Promise<T[]>;
}

interface AccountRow {
  id: string;
  creator_id: string;
  label: string;
  status: string;
  login_in_progress: boolean | string | number;
  session_rejected: boolean | string | number;
  has_storage_state: boolean | string | number;
  connection_status: string | null;
  identity_state: string | null;
  identity_label: string | null;
  identity_handle: string | null;
  identity_name: string | null;
  identity_user_id: string | null;
  identity_checked_at: Date | string | null;
  last_checked_at: Date | string | null;
  last_error: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

const DUPLICATE = "Esa creadora ya tiene una sesión de OnlyFans";

export class DbAccountStore implements AccountRepository {
  private tail: Promise<void> = Promise.resolve();
  private readonly sql: SqlQuery;
  private readonly now: () => Date;

  constructor(sql: SqlQuery, now: () => Date = () => new Date()) {
    this.sql = sql;
    this.now = now;
  }

  async init(): Promise<void> {
    try {
      await this.sql.query("select id from of_session_account limit 1");
    } catch {
      throw new Error(
        "Falta la tabla of_session_account. Aplica las migraciones.",
      );
    }
  }

  async list(): Promise<Account[]> {
    const rows = await this.sql.query<AccountRow>(
      "select * from of_session_account order by created_at asc, id asc",
    );
    return rows.map(rowToAccount);
  }

  async get(id: string): Promise<Account> {
    const rows = await this.sql.query<AccountRow>(
      "select * from of_session_account where id = $1",
      [id],
    );
    const row = rows[0];
    if (!row) throw new AccountNotFoundError(id);
    return rowToAccount(row);
  }

  async findByCreator(creatorId: string): Promise<Account | undefined> {
    const rows = await this.sql.query<AccountRow>(
      "select * from of_session_account where creator_id = $1",
      [creatorId],
    );
    const row = rows[0];
    return row ? rowToAccount(row) : undefined;
  }

  async create(label: string, creatorId?: string | null): Promise<Account> {
    const linked = parseCreatorId(creatorId);
    return this.enqueue(async () => {
      const timestamp = this.now().toISOString();
      const account: Account = {
        id: randomUUID(),
        creatorId: linked,
        label,
        status: "pending_login",
        loginInProgress: false,
        sessionRejected: false,
        hasStorageState: false,
        connection: "not_checked",
        identityState: "unavailable",
        identityLabel: null,
        identityHandle: null,
        identityName: null,
        identityUserId: null,
        identityCheckedAt: null,
        createdAt: timestamp,
        updatedAt: timestamp,
        lastCheckedAt: null,
        lastError: null,
      };
      try {
        await this.insert(account);
      } catch (error) {
        if (isUniqueViolation(error)) throw new InvalidArgumentError(DUPLICATE);
        throw error;
      }
      return { ...account };
    });
  }

  async update(id: string, patch: AccountPatch): Promise<Account> {
    return this.enqueue(async () => {
      const current = await this.get(id);
      const next: Account = {
        ...current,
        ...patch,
        id: current.id,
        creatorId: current.creatorId,
        createdAt: current.createdAt,
        updatedAt: this.now().toISOString(),
      };
      await this.upsertUnlocked(next);
      return next;
    });
  }

  async upsert(account: Account): Promise<void> {
    await this.enqueue(async () => {
      await this.upsertUnlocked(account);
    });
  }

  private async upsertUnlocked(account: Account): Promise<void> {
    if (!account.creatorId) {
      throw new InvalidArgumentError(
        "La sesión tiene que estar ligada a una creadora",
      );
    }
    try {
      await this.sql.query(
        `insert into of_session_account (
           id, creator_id, label, status, login_in_progress, session_rejected,
           has_storage_state, connection_status, identity_state, identity_label,
           identity_handle, identity_name, identity_user_id, identity_checked_at,
           last_checked_at, last_error, created_at, updated_at
         ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
         on conflict (id) do update set
           creator_id = excluded.creator_id,
           label = excluded.label,
           status = excluded.status,
           login_in_progress = excluded.login_in_progress,
           session_rejected = excluded.session_rejected,
           has_storage_state = excluded.has_storage_state,
           connection_status = excluded.connection_status,
           identity_state = excluded.identity_state,
           identity_label = excluded.identity_label,
           identity_handle = excluded.identity_handle,
           identity_name = excluded.identity_name,
           identity_user_id = excluded.identity_user_id,
           identity_checked_at = excluded.identity_checked_at,
           last_checked_at = excluded.last_checked_at,
           last_error = excluded.last_error,
           updated_at = excluded.updated_at`,
        accountParams(account),
      );
    } catch (error) {
      if (isUniqueViolation(error)) throw new InvalidArgumentError(DUPLICATE);
      throw error;
    }
  }

  private async insert(account: Account): Promise<void> {
    await this.sql.query(
      `insert into of_session_account (
         id, creator_id, label, status, login_in_progress, session_rejected,
         has_storage_state, connection_status, identity_state, identity_label,
         identity_handle, identity_name, identity_user_id, identity_checked_at,
         last_checked_at, last_error, created_at, updated_at
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
      accountParams(account),
    );
  }

  private async enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.tail.then(fn, fn);
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}

function accountParams(account: Account): unknown[] {
  return [
    account.id,
    account.creatorId,
    account.label,
    account.status,
    account.loginInProgress,
    account.sessionRejected,
    account.hasStorageState,
    account.connection,
    account.identityState,
    account.identityLabel,
    account.identityHandle,
    account.identityName,
    account.identityUserId,
    account.identityCheckedAt,
    account.lastCheckedAt,
    account.lastError,
    account.createdAt,
    account.updatedAt,
  ];
}

function rowToAccount(row: AccountRow): Account {
  return {
    id: row.id,
    creatorId: row.creator_id,
    label: row.label,
    status: parseStatus(row.status),
    loginInProgress: asBool(row.login_in_progress),
    sessionRejected: asBool(row.session_rejected),
    hasStorageState: asBool(row.has_storage_state),
    connection:
      row.connection_status === "live" || row.connection_status === "rejected" || row.connection_status === "inconclusive"
        ? row.connection_status
        : "not_checked",
    identityState:
      row.identity_state === "verified" || row.identity_state === "mismatch" ? row.identity_state : "unavailable",
    identityLabel: row.identity_label ?? null,
    identityHandle: row.identity_handle ?? null,
    identityName: row.identity_name ?? null,
    identityUserId: row.identity_user_id ?? null,
    identityCheckedAt: row.identity_checked_at == null ? null : asIso(row.identity_checked_at),
    createdAt: asIso(row.created_at),
    updatedAt: asIso(row.updated_at),
    lastCheckedAt:
      row.last_checked_at == null ? null : asIso(row.last_checked_at),
    lastError: row.last_error ?? null,
  };
}

function parseStatus(value: string): SessionStatus {
  switch (value) {
    case "active":
    case "expired":
    case "pending_login":
      return value;
    default:
      return "pending_login";
  }
}

function asBool(value: boolean | string | number): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  return value === "t" || value === "true" || value === "1";
}

function asIso(value: Date | string): string {
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toISOString();
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "23505",
  );
}
