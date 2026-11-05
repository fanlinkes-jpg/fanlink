import type { IdentityState } from "./types.ts";

/**
 * Identidad de la cuenta que tiene la sesión.
 *
 * Fuente, en este orden:
 * 1. Una respuesta JSON que la propia página pide al cargar, y solo si la URL
 *    parece la del usuario actual (`/users/me`, `/me` o `/api/me`). De ese JSON
 *    se copian `username`, `name` o `displayName`, e `id` si es numérico.
 *    No se llama a ningún endpoint por nuestra cuenta ni se firma nada.
 * 2. Si no hubo esa respuesta y el adaptador declara `identitySelector`, el
 *    texto visible y, si existen, `data-username` y `data-user-id`.
 *
 * Fragilidad: si OnlyFans deja de pedir esa URL o cambia los nombres de los
 * campos, la conexión puede seguir en Aceptada y la identidad en No verificada.
 * No se usa la cookie como nombre. No se guardan el resto de campos del JSON.
 */

export type { IdentityState };

export type ReadIdentity = {
  username: string | null;
  name: string | null;
  userId: string | null;
};

const USERNAME_MAX = 80;
const NAME_MAX = 80;

export function normalizeHandle(value: string): string {
  return value.trim().replace(/^@+/, "").toLowerCase();
}

export function judgeIdentityMatch(expectedHandle: string, readUsername: string | null): IdentityState {
  if (!readUsername || !normalizeHandle(readUsername)) return "unavailable";
  const expected = normalizeHandle(expectedHandle);
  if (!expected) return "unavailable";
  return normalizeHandle(readUsername) === expected ? "verified" : "mismatch";
}

export function isCurrentUserResponseUrl(url: string): boolean {
  let path: string;
  try {
    path = new URL(url).pathname.replace(/\/+$/, "").toLowerCase();
  } catch {
    return false;
  }
  return path.endsWith("/users/me") || path.endsWith("/me") || path.endsWith("/api/me");
}

export function identityFromUserJson(value: unknown): ReadIdentity | null {
  const user = userRecord(value);
  if (!user) return null;
  const username = cleanText(user.username, USERNAME_MAX);
  if (!username) return null;
  const name = cleanText(user.name, NAME_MAX) ?? cleanText(user.displayName, NAME_MAX);
  return { username, name, userId: numericId(user.id) };
}

export function identityFromDom(
  selector: string | undefined,
  dom: { text: string | null; username: string | null; userId: string | null } | null,
): ReadIdentity | null {
  if (!selector || !dom) return null;
  const username = cleanText(dom.username, USERNAME_MAX);
  const name = cleanText(dom.text, NAME_MAX);
  const userId = numericId(dom.userId);
  if (!username && !name && !userId) return null;
  return { username, name, userId };
}

export function assertAccountDataRead(identityState: IdentityState): void {
  if (identityState === "mismatch") {
    throw new Error("Lecturas bloqueadas: la sesión guardada es de otra cuenta.");
  }
}

function userRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.username === "string") return record;
  const nested = record.user;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    const user = nested as Record<string, unknown>;
    if (typeof user.username === "string") return user;
  }
  return null;
}

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.slice(0, max);
}

function numericId(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(Math.trunc(value));
  if (typeof value === "string" && /^\d{1,20}$/.test(value)) return value;
  return null;
}
