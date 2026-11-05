export type SessionStatus = "active" | "expired" | "pending_login";

export interface Account {
  id: string;
  label: string;
  status: SessionStatus;
  loginInProgress: boolean;
  sessionRejected: boolean;
  hasStorageState: boolean;
  createdAt: string;
  updatedAt: string;
  lastCheckedAt: string | null;
  lastError: string | null;
}

export class AccountNotFoundError extends Error {
  constructor(id: string) {
    super(`No existe la cuenta ${id}`);
    this.name = "AccountNotFoundError";
  }
}

export class InvalidArgumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidArgumentError";
  }
}

export class SessionPendingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionPendingError";
  }
}

export class SessionInvalidError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionInvalidError";
  }
}

const ACCOUNT_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function assertAccountId(id: string): string {
  if (!ACCOUNT_ID.test(id)) {
    throw new AccountNotFoundError(id);
  }
  return id;
}

export function parseLabel(input: unknown): string {
  if (typeof input !== "string") {
    throw new InvalidArgumentError("El nombre de la cuenta es obligatorio");
  }
  const label = input.trim();
  if (label.length < 1 || label.length > 80) {
    throw new InvalidArgumentError("El nombre debe tener entre 1 y 80 caracteres");
  }
  return label;
}
