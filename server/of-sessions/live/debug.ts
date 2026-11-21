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
