import { messages } from "./messages.ts";
import type { IdentityState } from "./types.ts";

/**
 * Identidad de la cuenta que tiene la sesión. No se llama a ningún endpoint
 * ni se firma nada. Orden:
 * 1. JSON que la propia página pide al cargar, si la ruta contiene `/users/me`
 *    (aunque lleve query o el prefijo `/api2/v2/`) o termina en `/api/me`.
 *    Se copian `username` (o `userName` / `user_name`), `name` o `displayName`,
 *    e `id` numérico.
 * 2. Estado que la página ya tiene: `window.__INITIAL_STATE__`, `__NUXT__`,
 *    `__PINIA__`, el store de Vuex o Pinia. Solo lectura.
 * 3. Selector declarado por el adaptador (`#fanlink-identity` en las pruebas).
 * 4. Enlace del menú lateral con href `/<username>`, o un único `@username`
 *    visible en ese menú.
 *
 * Fragilidad: si OnlyFans cambia la ruta, los campos o el menú, la conexión
 * puede seguir en Aceptada y la identidad en No verificada. En ese caso se
 * guarda una razón y las rutas JSON sin query, cookies, cabeceras ni cuerpos.
 * No se usa la cookie como nombre.
 */

export type { IdentityState };

export type ReadIdentity = {
  username: string | null;
  name: string | null;
  userId: string | null;
};

export type IdentityNotes = {
  sawUsersMe: boolean;
  usersMeUnreadable: boolean;
  usersMeMissingUsername: boolean;
  redirectedToLogin: boolean;
  guest: boolean;
  sawLoginChallenge: boolean;
  jsonPaths: string[];
};

export type UsersMeVerdict =
  | { kind: "logged_in"; identity: ReadIdentity }
  | { kind: "guest"; authRejected: boolean }
  | { kind: "unknown" };

const USERNAME_MAX = 80;
const NAME_MAX = 80;
const REASON_MAX = 400;
const RESERVED_PATHS = new Set([
  "my",
  "posts",
  "login",
  "auth",
  "help",
  "about",
  "terms",
  "privacy",
  "home",
  "messages",
  "chats",
  "notifications",
  "settings",
  "payments",
  "search",
  "explore",
  "api",
  "api2",
  "subscriptions",
  "bookmarks",
  "lists",
  "vault",
  "queue",
  "support",
  "faq",
  "cookies",
  "banking",
  "statements",
  "statistics",
]);

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
  const path = pathnameOf(url);
  if (!path) return false;
  return path.includes("/users/me") || path.endsWith("/api/me");
}

/** Ruta absoluta sin usuario, query ni hash. Null si la URL no se puede leer. */
export function jsonUrlWithoutSecrets(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.username || parsed.password) return null;
    return `${parsed.origin}${parsed.pathname}`.slice(0, 200);
  } catch {
    return null;
  }
}

export function isLoginChallengeUrl(url: string): boolean {
  const path = pathnameOf(url);
  if (!path) return false;
  return path.includes("/webauthn/login") || path.includes("/posts/login") || path.includes("/login/options");
}

/**
 * users/me con HTTP 200 no basta. Si `isAuth` viene y no es true, o falta
 * el id o el username, es la respuesta de invitado: la sesión está caducada.
 * Un cuerpo con id y username y sin el campo `isAuth` sigue siendo una
 * cuenta (el sitio de prueba no manda ese campo).
 */
export function usersMeVerdict(value: unknown): UsersMeVerdict {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { kind: "unknown" };
  const record = value as Record<string, unknown>;
  const user = userRecord(value) ?? record;
  if (authFlagRejects(user) || authFlagRejects(record)) return { kind: "guest", authRejected: true };
  const identity = identityFromUserJson(value);
  if (!identity?.username || !identity.userId || identity.userId === "0") return { kind: "guest", authRejected: false };
  return { kind: "logged_in", identity };
}

/** Solo `logged_in` es una sesión. Invitado y cuerpo ilegible no validan la cuenta. */
export function usersMeKeepsSession(verdict: UsersMeVerdict): boolean {
  return verdict.kind === "logged_in";
}

export function identityFailureReason(notes: IdentityNotes): string {
  if (notes.redirectedToLogin || notes.guest || notes.sawLoginChallenge) return messages.loginRequired;
  let reason = "no se pudo leer el usuario";
  if (notes.usersMeUnreadable) reason = "respuesta users/me no legible";
  else if (notes.usersMeMissingUsername) reason = "campo username ausente";
  else if (!notes.sawUsersMe) reason = "no hubo respuesta users/me";
  reason = `${reason}. sin usuario en el estado ni en el menú`;
  const paths = [...new Set(notes.jsonPaths)].filter((path) => !path.includes("?")).slice(0, 8);
  if (paths.length) reason = `${reason}. json: ${paths.join(", ")}`;
  return reason.slice(0, REASON_MAX);
}

function authFlagRejects(record: Record<string, unknown>): boolean {
  if ("isAuth" in record && record.isAuth !== true) return true;
  if ("isAuthenticated" in record && record.isAuthenticated !== true) return true;
  if (record.isGuest === true || record.guest === true) return true;
  return false;
}

export function identityFromUserJson(value: unknown): ReadIdentity | null {
  const user = userRecord(value);
  if (!user) return null;
  const username =
    cleanText(user.username, USERNAME_MAX) ??
    cleanText(user.userName, USERNAME_MAX) ??
    cleanText(user.user_name, USERNAME_MAX);
  if (!username) return null;
  const name = cleanText(user.name, NAME_MAX) ?? cleanText(user.displayName, NAME_MAX);
  const userId = numericId(user.id) ?? numericId(user.userId) ?? numericId(user.user_id);
  return { username, name, userId };
}

export function identityFromStateCandidates(value: unknown): ReadIdentity | null {
  if (!Array.isArray(value)) return null;
  const ranked: Array<{ username: string; name: string | null; userId: string | null; score: number }> = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const username = cleanText(record.username, USERNAME_MAX);
    if (!username) continue;
    const score =
      (record.markedCurrent === true ? 5 : 0) +
      (record.preferred === true ? 4 : 0) +
      (record.inList === true ? -3 : 0);
    ranked.push({
      username,
      name: cleanText(record.name, NAME_MAX),
      userId: numericId(record.userId),
      score,
    });
  }
  ranked.sort((left, right) => right.score - left.score);
  const best = ranked[0];
  if (!best || best.score < 0) return null;
  const second = ranked[1];
  if (best.score < 4 && second && normalizeHandle(second.username) !== normalizeHandle(best.username)) return null;
  return { username: best.username, name: best.name, userId: best.userId };
}

export function identityFromMenu(hrefs: unknown, handles: unknown): ReadIdentity | null {
  const fromLinks: string[] = [];
  if (Array.isArray(hrefs)) {
    for (const href of hrefs) {
      if (typeof href !== "string") continue;
      const username = usernameFromHref(href);
      if (username) fromLinks.push(username);
    }
  }
  const uniqueLinks = [...new Set(fromLinks.map((item) => normalizeHandle(item)))];
  if (uniqueLinks.length === 1) {
    const username = fromLinks.find((item) => normalizeHandle(item) === uniqueLinks[0]) ?? uniqueLinks[0];
    return { username, name: null, userId: null };
  }
  const fromText: string[] = [];
  if (Array.isArray(handles)) {
    for (const handle of handles) {
      if (typeof handle !== "string") continue;
      const username = cleanText(handle.replace(/^@+/, ""), USERNAME_MAX);
      if (username && /^[A-Za-z0-9._]{2,30}$/.test(username)) fromText.push(username);
    }
  }
  const uniqueHandles = [...new Set(fromText.map((item) => normalizeHandle(item)))];
  if (uniqueHandles.length === 1) {
    return { username: uniqueHandles[0] ?? null, name: null, userId: null };
  }
  return null;
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

/**
 * Se ejecuta dentro de la página. No recibe ni devuelve cookies, cabeceras
 * ni cuerpos. Los href salen sin query.
 */
export function readPageSignals(): {
  candidates: Array<{
    username: string;
    name: string | null;
    userId: string | null;
    preferred: boolean;
    inList: boolean;
    markedCurrent: boolean;
  }>;
  menuHrefs: string[];
  menuHandles: string[];
} {
  const candidates: Array<{
    username: string;
    name: string | null;
    userId: string | null;
    preferred: boolean;
    inList: boolean;
    markedCurrent: boolean;
  }> = [];
  const seen = new Set<string>();
  const secretKey = /password|token|cookie|secret|sess|authorization|csrf/i;
  function walk(value: unknown, path: string, depth: number, budget: { n: number }, inList: boolean): void {
    if (!value || typeof value !== "object" || depth > 6 || budget.n <= 0 || candidates.length >= 30) return;
    budget.n -= 1;
    const record = value as Record<string, unknown>;
    if (!Array.isArray(value) && typeof record.username === "string") {
      const username = record.username.replace(/\s+/g, " ").trim().slice(0, 80);
      const key = `${path}:${username}`;
      if (username && !seen.has(key)) {
        seen.add(key);
        const id = record.id;
        const userId =
          typeof id === "number" && Number.isFinite(id)
            ? String(Math.trunc(id))
            : typeof id === "string" && /^\d{1,20}$/.test(id)
              ? id
              : null;
        const name =
          typeof record.name === "string"
            ? record.name.slice(0, 80)
            : typeof record.displayName === "string"
              ? record.displayName.slice(0, 80)
              : null;
        candidates.push({
          username,
          name,
          userId,
          preferred: /(^|\.)(me|auth|user|profile|account|currentuser|current)$/i.test(path) || /auth\.user|users\.me/i.test(path),
          inList,
          markedCurrent: record.isAuth === true || record.isCurrent === true || record.isMe === true,
        });
      }
    }
    const entries = Array.isArray(value)
      ? value.slice(0, 8).map((item, index) => [String(index), item] as const)
      : Object.entries(record)
          .slice(0, 40)
          .filter(([key]) => !secretKey.test(key));
    for (const [key, child] of entries) walk(child, path ? `${path}.${key}` : key, depth + 1, budget, inList || Array.isArray(value));
  }
  const roots: Array<[string, unknown]> = [];
  const win = window as unknown as Record<string, unknown>;
  for (const key of ["__INITIAL_STATE__", "__NUXT__", "__PINIA__"]) {
    if (win[key] && typeof win[key] === "object") roots.push([key, win[key]]);
  }
  const el = document.querySelector("#app") || document.querySelector("#__nuxt");
  const host = el as (HTMLElement & {
    __vue__?: { $store?: { state?: unknown } };
    __vue_app__?: { config?: { globalProperties?: { $pinia?: { state?: { value?: unknown } } } } };
  }) | null;
  const vue = host?.__vue__;
  if (vue?.$store?.state) roots.push(["vuex", vue.$store.state]);
  const pinia = host?.__vue_app__?.config?.globalProperties?.$pinia;
  if (pinia?.state?.value) roots.push(["pinia", pinia.state.value]);
  const budget = { n: 1500 };
  for (const [name, root] of roots) walk(root, name, 0, budget, false);
  const menuHrefs: string[] = [];
  const menuHandles: string[] = [];
  const handleRe = /@([A-Za-z0-9._]{2,30})/g;
  for (const scope of document.querySelectorAll("aside, nav, header, [role='navigation']")) {
    for (const anchor of scope.querySelectorAll("a[href]")) {
      const raw = anchor.getAttribute("href") || "";
      const cut = raw.split("?")[0]?.split("#")[0] ?? "";
      if (cut) menuHrefs.push(cut.slice(0, 120));
    }
    const text = (scope.textContent || "").slice(0, 2000);
    handleRe.lastIndex = 0;
    let match = handleRe.exec(text);
    while (match) {
      if (match[1]) menuHandles.push(match[1]);
      match = handleRe.exec(text);
    }
  }
  return { candidates, menuHrefs: menuHrefs.slice(0, 40), menuHandles: menuHandles.slice(0, 20) };
}

function userRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (hasUsername(record)) return record;
  for (const key of ["user", "me", "account", "profile", "data"]) {
    const nested = record[key];
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      const user = nested as Record<string, unknown>;
      if (hasUsername(user)) return user;
    }
  }
  return null;
}

function hasUsername(record: Record<string, unknown>): boolean {
  return typeof record.username === "string" || typeof record.userName === "string" || typeof record.user_name === "string";
}

function usernameFromHref(href: string): string | null {
  let path = href.trim();
  if (!path || path.startsWith("//")) return null;
  try {
    if (path.startsWith("http://") || path.startsWith("https://")) path = new URL(path).pathname;
  } catch {
    return null;
  }
  const parts = path.split("?")[0]?.split("#")[0]?.split("/").filter(Boolean) ?? [];
  if (parts.length !== 1) return null;
  const name = parts[0];
  if (!name || !/^[A-Za-z0-9._]{2,30}$/.test(name)) return null;
  if (RESERVED_PATHS.has(name.toLowerCase())) return null;
  return name;
}

function pathnameOf(url: string): string | null {
  try {
    return new URL(url).pathname.replace(/\/+$/, "").toLowerCase();
  } catch {
    return null;
  }
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
