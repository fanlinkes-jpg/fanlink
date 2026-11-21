/** Diagnóstico de la vista nativa. Apagado salvo FANLINK_LIVE_VIEW_DEBUG=true. */
export function liveViewDebug(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.FANLINK_LIVE_VIEW_DEBUG?.trim().toLowerCase();
  return raw === "true" || raw === "1";
}

/** Solo el nombre. El valor no sale del proceso. */
export function clearancePresent(names: readonly string[]): boolean {
  return names.includes("cf_clearance");
}

export function liveChallengeUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw, "https://onlyfans.com");
  } catch {
    return false;
  }
  const host = url.hostname.toLowerCase();
  const path = url.pathname.toLowerCase();
  return host === "challenges.cloudflare.com" || host.endsWith(".challenges.cloudflare.com") || path.includes("/cdn-cgi/");
}

const VAULT_SECRET_PARAM = /sign|cookie|sess|token|auth|policy|x-?bc|^(?:user-id|user_id)$/i;
const VAULT_ENUM_VALUE = /^(all|desc|asc|recent|photo|video|audio|gif|custom|posts|stories|messages|streams|media|main|true|false)$/i;
const VAULT_PATH_WORD = /^(api2|v2|vault|media|lists|list|categories|processing|hidden)$/;

/**
 * Método y ruta de la bóveda web. Los números pasan a `<n>`.
 * Un texto que no es un valor fijo pasa a `<t>`. No salen cabeceras ni secretos.
 */
export function vaultWebTrace(method: string, raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw, "https://onlyfans.com");
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (host !== "onlyfans.com" && host !== "www.onlyfans.com") return null;
  let path = url.pathname;
  try {
    path = decodeURIComponent(path);
  } catch {
    return null;
  }
  if (!path.startsWith("/api2/v2/vault")) return null;
  const safePath = path
    .split("/")
    .map((part) => {
      if (part === "") return "";
      if (/^\d+$/.test(part)) return "<n>";
      if (VAULT_PATH_WORD.test(part)) return part;
      return "<t>";
    })
    .join("/");
  const verb = method.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 8) || "GET";
  const params: string[] = [];
  for (const [key, value] of url.searchParams) {
    if (VAULT_SECRET_PARAM.test(key)) continue;
    const name = key.replace(/[^\w.-]/g, "").slice(0, 40);
    if (!name) continue;
    params.push(`${name}=${redactVaultParam(value)}`);
  }
  const query = params.length > 0 ? `?${params.join("&")}` : "";
  return `${verb} ${safePath}${query}`;
}

function redactVaultParam(value: string): string {
  const trimmed = value.trim();
  if (/^-?\d+$/.test(trimmed)) return "<n>";
  if (VAULT_ENUM_VALUE.test(trimmed)) return trimmed.toLowerCase();
  return "<t>";
}

/**
 * Método, host y ruta. Sin query, sin hash y sin segmentos largos
 * (ahí viaja el token del reto).
 */
export function liveRequestTrace(method: string, raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw, "https://onlyfans.com");
  } catch {
    return null;
  }
  let path = url.pathname;
  try {
    path = decodeURIComponent(path);
  } catch {
    return null;
  }
  const safe = path
    .split("/")
    .map((part) => (part.length >= 24 ? ":id" : part.slice(0, 80)))
    .join("/");
  const verb = method.toUpperCase().slice(0, 8);
  return `${verb} ${url.hostname.toLowerCase()}${safe}`;
}
