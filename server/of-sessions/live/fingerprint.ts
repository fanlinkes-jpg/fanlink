import { BROWSER_FINGERPRINT } from "../sessions/browser-factory.ts";

/** Misma cadena que Conectar. La sesión de OnlyFans queda atada a este UA. */
export const LOGIN_USER_AGENT = BROWSER_FINGERPRINT.userAgent;

/**
 * Brands alineados con Chrome/131, no con el Chromium 156 del binario.
 * Si no, Sec-CH-UA dice Chromium y el UA dice Chrome/131.
 */
export const LOGIN_CLIENT_HINTS = {
  brands: [
    { brand: "Chromium", version: "131" },
    { brand: "Google Chrome", version: "131" },
    { brand: "Not_A Brand", version: "24" },
  ],
  fullVersionList: [
    { brand: "Chromium", version: "131.0.6778.86" },
    { brand: "Google Chrome", version: "131.0.6778.86" },
    { brand: "Not_A Brand", version: "24.0.0.0" },
  ],
  fullVersion: "131.0.6778.86",
  platform: "macOS",
  platformVersion: "10.15.7",
  architecture: "x86",
  model: "",
  mobile: false,
  bitness: "64",
  wow64: false,
} as const;

export function loginUserAgentOverride(): {
  userAgent: string;
  acceptLanguage: string;
  platform: string;
  userAgentMetadata: typeof LOGIN_CLIENT_HINTS;
} {
  return {
    userAgent: LOGIN_USER_AGENT,
    acceptLanguage: "es-ES,es;q=0.9",
    platform: "MacIntel",
    userAgentMetadata: LOGIN_CLIENT_HINTS,
  };
}
