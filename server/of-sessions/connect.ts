import { assertNoCredentials } from "./credentials.ts";
import type { SessionManager } from "./sessions/session-manager.ts";
import type { Account } from "./types.ts";
import { InvalidArgumentError, parseCreatorId, parseLabel } from "./types.ts";

export async function beginCreatorLogin(
  sessions: SessionManager,
  input: unknown,
): Promise<Account> {
  assertNoCredentials(input);
  if (!isRecord(input))
    throw new InvalidArgumentError("La creadora no es válida");
  if (input.platform !== undefined && input.platform !== "OnlyFans") {
    throw new InvalidArgumentError(
      "La ventana de Chromium solo conecta cuentas de OnlyFans",
    );
  }
  const creatorId = parseCreatorId(input.creatorId);
  const label = parseLabel(input.label);
  const account = await sessions.ensureAccount(label, creatorId);
  return sessions.beginInteractiveLogin(account.id);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
