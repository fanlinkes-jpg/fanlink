import type { StorageCookie } from "./storage-state.ts";
import { judgeStorageState } from "./storage-state.ts";

export interface SiteAdapter {
  id: string;
  origin: string;
  hostname: string;
  loginUrl: string;
  probeUrl: string;
  /** Segunda página si la home no trae el usuario. No se llama a una API. */
  profileUrl?: string;
  /** Páginas normales de ganancias y fans. La sincronización solo las abre. */
  earningsUrl?: string;
  subscribersUrl?: string;
  /** Página normal de conversaciones. La sincronización solo la abre. */
  chatsUrl?: string;
  requiredCookies: readonly string[];
  /**
   * Selector del formulario de acceso. Si sigue visible, la persona
   * todavía no ha entrado (o la sesión ya no sirve).
   */
  loggedOutSelector?: string;
  /**
   * Selector de un nombre visible ya acordado con el sitio.
   * Si no está, la identidad queda como no verificable.
   */
  identitySelector?: string;
  isDashboardUrl(url: string): boolean;
  isLoginUrl(url: string): boolean;
  isInconclusiveUrl?(url: string): boolean;
  isAuthenticated(
    url: string,
    cookies: readonly StorageCookie[],
    nowMs: number,
  ): boolean;
  assertRequestUrl(url: string): void;
}

export function hasLiveCookies(
  site: Pick<SiteAdapter, "requiredCookies" | "hostname">,
  cookies: readonly StorageCookie[],
  nowMs: number,
): boolean {
  return (
    judgeStorageState(
      { cookies: [...cookies], origins: [] },
      site.requiredCookies,
      site.hostname,
      nowMs,
    ) === "valid"
  );
}
