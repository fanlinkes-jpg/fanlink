export interface StorageCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  /** Segundos Unix. -1 significa cookie de sesión, sin fecha de caducidad. */
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: "Strict" | "Lax" | "None";
}

export interface StorageOrigin {
  origin: string;
  localStorage: Array<{ name: string; value: string }>;
}

export interface StorageStateFile {
  cookies: StorageCookie[];
  origins: StorageOrigin[];
}

export type LocalSessionVerdict = "missing" | "valid" | "expired";

export function domainMatches(cookieDomain: string, host: string): boolean {
  const normalized = cookieDomain.replace(/^\./, "").toLowerCase();
  const target = host.toLowerCase();
  if (!normalized || normalized.includes("/")) return false;
  return target === normalized || target.endsWith(`.${normalized}`);
}

export function isCookieUnexpired(expires: number, nowMs: number): boolean {
  if (expires === -1) return true;
  if (!Number.isFinite(expires)) return false;
  return expires * 1000 > nowMs;
}

export function parseStorageState(raw: unknown): StorageStateFile {
  if (!raw || typeof raw !== "object") {
    throw new Error("El storage state no es un JSON válido");
  }
  const record = raw as { cookies?: unknown; origins?: unknown };
  if (!Array.isArray(record.cookies) || !Array.isArray(record.origins)) {
    throw new Error("El storage state no tiene cookies y origins");
  }
  const cookies: StorageCookie[] = [];
  for (const entry of record.cookies) {
    if (!entry || typeof entry !== "object") {
      throw new Error("Cookie de storage state ilegible");
    }
    const cookie = entry as Partial<StorageCookie>;
    if (typeof cookie.name !== "string" || typeof cookie.value !== "string") {
      throw new Error("Cookie de storage state ilegible");
    }
    if (typeof cookie.domain !== "string" || typeof cookie.path !== "string") {
      throw new Error("Cookie de storage state ilegible");
    }
    if (typeof cookie.expires !== "number") {
      throw new Error("Cookie de storage state ilegible");
    }
    cookies.push({
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path,
      expires: cookie.expires,
      httpOnly: Boolean(cookie.httpOnly),
      secure: Boolean(cookie.secure),
      sameSite: cookie.sameSite === "Strict" || cookie.sameSite === "None" ? cookie.sameSite : "Lax",
    });
  }
  const origins: StorageOrigin[] = [];
  for (const entry of record.origins) {
    if (!entry || typeof entry !== "object") {
      throw new Error("Origin de storage state ilegible");
    }
    const origin = entry as { origin?: unknown; localStorage?: unknown };
    if (typeof origin.origin !== "string" || !Array.isArray(origin.localStorage)) {
      throw new Error("Origin de storage state ilegible");
    }
    const localStorage: Array<{ name: string; value: string }> = [];
    for (const item of origin.localStorage) {
      if (!item || typeof item !== "object") {
        throw new Error("localStorage de storage state ilegible");
      }
      const pair = item as { name?: unknown; value?: unknown };
      if (typeof pair.name !== "string" || typeof pair.value !== "string") {
        throw new Error("localStorage de storage state ilegible");
      }
      localStorage.push({ name: pair.name, value: pair.value });
    }
    origins.push({ origin: origin.origin, localStorage });
  }
  return { cookies, origins };
}

/**
 * Una sesión guardada es válida solo si todas las cookies requeridas
 * siguen presentes, pertenecen al host y no han caducado.
 * Un archivo vacío o incompleto cuenta como expirado: el archivo existe,
 * pero no sirve para entrar.
 */
export function judgeStorageState(
  state: StorageStateFile,
  requiredCookies: readonly string[],
  host: string,
  nowMs: number,
): "valid" | "expired" {
  const usable = new Set<string>();
  for (const cookie of state.cookies) {
    if (!cookie.name || !cookie.value) continue;
    if (!domainMatches(cookie.domain, host)) continue;
    if (!isCookieUnexpired(cookie.expires, nowMs)) continue;
    usable.add(cookie.name);
  }
  const ok = requiredCookies.every((name) => usable.has(name));
  return ok ? "valid" : "expired";
}
