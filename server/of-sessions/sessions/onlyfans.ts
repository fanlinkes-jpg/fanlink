import { InvalidArgumentError } from "../types.ts";
import { messages } from "../messages.ts";
import type { SiteAdapter } from "./site.ts";
import { hasLiveCookies } from "./site.ts";
import type { StorageCookie } from "./storage-state.ts";

const LOGIN_PATH = /^\/(login|auth)(\/|$)/i;

export function isOnlyFansHost(hostname: string): boolean {
  return hostname === "onlyfans.com" || hostname === "www.onlyfans.com";
}

function parseHttpUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new InvalidArgumentError(messages.invalidUrl);
  }
  if (url.username || url.password) {
    throw new InvalidArgumentError(messages.urlCredentials);
  }
  return url;
}

/**
 * OnlyFans sirve el formulario en https://onlyfans.com/ y, tras el acceso,
 * se queda en esa misma URL (el feed) o entra en /my/.... La sesión no se
 * da por buena hasta que aparecen las cookies auth_id y sess y desaparece
 * el formulario. Captcha y doble factor ocurren en esa misma ventana;
 * este módulo no los resuelve.
 */
export const onlyFansSite: SiteAdapter = {
  id: "onlyfans",
  origin: "https://onlyfans.com",
  hostname: "onlyfans.com",
  loginUrl: "https://onlyfans.com/",
  probeUrl: "https://onlyfans.com/",
  profileUrl: "https://onlyfans.com/my/profile",
  requiredCookies: ["auth_id", "sess"],
  loggedOutSelector: 'input[type="password"]',
  isDashboardUrl(raw: string): boolean {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return false;
    }
    if (!isOnlyFansHost(url.hostname)) return false;
    if (LOGIN_PATH.test(url.pathname)) return false;
    return (
      url.pathname === "/" ||
      url.pathname.startsWith("/my/") ||
      url.pathname.startsWith("/posts")
    );
  },
  isLoginUrl(raw: string): boolean {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return false;
    }
    return isOnlyFansHost(url.hostname) && LOGIN_PATH.test(url.pathname);
  },
  isInconclusiveUrl(raw: string): boolean {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return false;
    }
    return (
      url.hostname.includes("cloudflare") ||
      url.pathname.includes("/cdn-cgi/") ||
      url.pathname.includes("/challenge")
    );
  },
  isAuthenticated(
    raw: string,
    cookies: readonly StorageCookie[],
    nowMs: number,
  ): boolean {
    return this.isDashboardUrl(raw) && hasLiveCookies(this, cookies, nowMs);
  },
  assertRequestUrl(raw: string): void {
    const url = parseHttpUrl(raw);
    if (url.protocol !== "https:") {
      throw new InvalidArgumentError(messages.originRejected);
    }
    if (!isOnlyFansHost(url.hostname)) {
      throw new InvalidArgumentError(messages.originRejected);
    }
  },
};
