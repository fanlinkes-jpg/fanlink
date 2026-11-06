import { messages } from "./messages.ts";
import { InvalidArgumentError } from "./types.ts";

const FORBIDDEN_FIELDS = new Set([
  "password",
  "pass",
  "passwd",
  "username",
  "user",
  "email",
  "cookie",
  "cookies",
  "storagestate",
  "storage_state",
]);

export function assertNoCredentials(body: unknown): void {
  if (!isRecord(body)) return;
  for (const key of Object.keys(body)) {
    if (FORBIDDEN_FIELDS.has(key.toLowerCase())) {
      throw new InvalidArgumentError(messages.credentialsRejected);
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
