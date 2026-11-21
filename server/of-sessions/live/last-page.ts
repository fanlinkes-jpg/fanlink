const last = new Map<string, string>();

/** Última ruta de OnlyFans que la vista dejó abierta. Sin query. */
export function rememberLivePage(accountId: string, url: string): void {
  const safe = safeLivePage(url);
  if (safe) last.set(accountId, safe);
}

export function lastLivePage(accountId: string): string | null {
  return last.get(accountId) ?? null;
}

export function safeLivePage(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (host !== "onlyfans.com" && host !== "www.onlyfans.com") return null;
  return `https://onlyfans.com${url.pathname}`;
}
