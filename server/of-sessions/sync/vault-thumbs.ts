import { BROWSER_FINGERPRINT } from "../sessions/browser-factory.ts";
import { mediaHostAllowed, nextMediaUrl } from "./history.ts";
import { getVaultThumb, putVaultThumb, type MediaBytes } from "./media-bytes.ts";
import { sessionForApi } from "./of-chat-api.ts";
import type { StorageStateFile } from "../sessions/storage-state.ts";

/** Una página de `vault/media`. */
export const VAULT_THUMB_PAGE = 40;
const THUMB_MAX_BYTES = 1_500_000;

export type ThumbBrowser = {
  get(url: string): Promise<{ ok: boolean; status: number; body: Uint8Array; contentType: string }>;
  release(): Promise<void>;
};

export type ThumbItem = { id: string; preview: string | null };

const refreshInflight = new Map<string, Promise<readonly ThumbItem[]>>();

/** Varias miniaturas de la misma página comparten una sola relectura de `vault/media`. */
export function shareRefresh(creatorId: string, load: () => Promise<readonly ThumbItem[]>): Promise<readonly ThumbItem[]> {
  const existing = refreshInflight.get(creatorId);
  if (existing) return existing;
  const pending = load().finally(() => {
    refreshInflight.delete(creatorId);
  });
  refreshInflight.set(creatorId, pending);
  return pending;
}

export function sessionThumbHeaders(state: StorageStateFile, nowMs: number): Record<string, string> | null {
  const auth = sessionForApi(state, nowMs);
  if (!("cookie" in auth)) return null;
  return {
    accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
    referer: "https://onlyfans.com/",
    "user-agent": BROWSER_FINGERPRINT.userAgent,
    cookie: auth.cookie,
  };
}

/** Una URL firmada ya vencida no se pide. `Expires` o la Policy de CloudFront. */
export function signedUrlExpired(raw: string, nowMs: number): boolean {
  try {
    const url = new URL(raw);
    const expires = url.searchParams.get("Expires") ?? url.searchParams.get("expires");
    const expiry = expires ? unixSeconds(expires) : null;
    if (expiry != null && expiry * 1000 <= nowMs) return true;
    const policy = url.searchParams.get("Policy");
    if (!policy) return false;
    const epoch = policyEpoch(policy);
    return epoch != null && epoch * 1000 <= nowMs;
  } catch {
    return false;
  }
}

export function logThumbStatus(status: number): void {
  if (status <= 0) return;
  console.info(`[fanlink:vault] miniatura status=${status}`);
}

/**
 * Bytes de la miniatura. Si la URL está caducada o el CDN responde 403/410,
 * `reload` se llama una sola vez y se usa la URL nueva.
 */
export async function loadFreshPreview(input: {
  creatorId: string;
  mediaId: string;
  url: string;
  now?: number;
  read: (url: string) => Promise<{ status: number; media: MediaBytes | null }>;
  reload: () => Promise<string | null>;
}): Promise<MediaBytes | null> {
  const now = input.now ?? Date.now();
  let url = input.url;
  let reloaded = false;
  if (!url || signedUrlExpired(url, now)) {
    const next = await reloadUsable(input.reload, url, now);
    reloaded = true;
    if (!next) return null;
    url = next;
  }
  const first = await input.read(url);
  const stored = storeImage(input.creatorId, input.mediaId, first.media);
  if (stored) return stored;
  if (first.media) return first.media;
  if (first.status !== 403 && first.status !== 410) {
    logThumbStatus(first.status);
    return null;
  }
  logThumbStatus(first.status);
  if (reloaded) return null;
  const next = await reloadUsable(input.reload, url, now);
  if (!next) return null;
  const second = await input.read(next);
  const again = storeImage(input.creatorId, input.mediaId, second.media);
  if (again) return again;
  if (!second.media) logThumbStatus(second.status);
  return second.media;
}

/** Miniaturas de la página visible. Como mucho un refresco de `vault/media` y un perfil. */
export async function preloadVaultThumbs(input: {
  creatorId: string;
  items: readonly ThumbItem[];
  fetch: typeof fetch;
  headers: Record<string, string>;
  now: number;
  refreshPage: () => Promise<readonly ThumbItem[]>;
  openBrowser?: () => Promise<ThumbBrowser | null>;
}): Promise<number> {
  const page = input.items.slice(0, VAULT_THUMB_PAGE).filter((item) => item.preview && mediaHostAllowed(item.preview));
  const failed: Array<{ id: string; url: string; expired: boolean }> = [];
  const noted = new Set<number>();
  const note = (status: number) => {
    if (noted.has(status)) return;
    noted.add(status);
    logThumbStatus(status);
  };
  let stored = 0;
  for (const item of page) {
    if (getVaultThumb(input.creatorId, item.id)) {
      stored += 1;
      continue;
    }
    const url = item.preview ?? "";
    if (signedUrlExpired(url, input.now)) {
      failed.push({ id: item.id, url, expired: true });
      continue;
    }
    const hit = await fetchThumb(input.fetch, url, input.headers);
    if (hit.body) {
      putVaultThumb(input.creatorId, item.id, hit.body, hit.contentType);
      stored += 1;
      continue;
    }
    if (hit.status === 403 || hit.status === 410) {
      note(hit.status);
      failed.push({ id: item.id, url, expired: false });
      continue;
    }
    note(hit.status);
  }
  if (failed.length === 0) return stored;

  let refreshed: readonly ThumbItem[] = [];
  try {
    refreshed = await input.refreshPage();
  } catch {
    refreshed = [];
  }
  const fresh = new Map(refreshed.map((item) => [item.id, item.preview]));
  const forBrowser: Array<{ id: string; url: string }> = [];
  for (const item of failed) {
    const next = usablePreview(fresh.get(item.id) ?? null, input.now);
    if (!next) continue;
    if (next === item.url && !item.expired) {
      forBrowser.push({ id: item.id, url: next });
      continue;
    }
    if (next === item.url) continue;
    const hit = await fetchThumb(input.fetch, next, input.headers);
    if (hit.body) {
      putVaultThumb(input.creatorId, item.id, hit.body, hit.contentType);
      stored += 1;
      continue;
    }
    note(hit.status);
    if ((hit.status === 403 || hit.status === 410) && !signedUrlExpired(next, input.now)) {
      forBrowser.push({ id: item.id, url: next });
    }
  }
  if (forBrowser.length === 0 || !input.openBrowser) return stored;
  const browser = await input.openBrowser();
  if (!browser) return stored;
  try {
    for (const item of forBrowser.slice(0, VAULT_THUMB_PAGE)) {
      const got = await browser.get(item.url);
      if (got.ok && imageBytes(got.body, got.contentType)) {
        putVaultThumb(input.creatorId, item.id, got.body, got.contentType);
        stored += 1;
        continue;
      }
      note(got.status);
    }
  } finally {
    await browser.release();
  }
  return stored;
}

export async function rememberVaultThumbs(input: {
  creatorId: string;
  items: readonly ThumbItem[];
  state: StorageStateFile;
  fetch: typeof fetch;
  now: number;
  refreshPage: () => Promise<readonly ThumbItem[]>;
  openBrowser?: () => Promise<ThumbBrowser | null>;
}): Promise<void> {
  const headers = sessionThumbHeaders(input.state, input.now);
  if (!headers) return;
  try {
    await preloadVaultThumbs({
      creatorId: input.creatorId,
      items: input.items,
      fetch: input.fetch,
      headers,
      now: input.now,
      refreshPage: input.refreshPage,
      openBrowser: input.openBrowser,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "miniaturas";
    console.info(`[fanlink:vault] miniaturas ${message.replace(/https?:\/\/\S+/gi, "").slice(0, 120)}`);
  }
}

async function reloadUsable(reload: () => Promise<string | null>, previous: string, now: number): Promise<string | null> {
  const next = usablePreview(await reload(), now);
  if (!next || next === previous) return null;
  return next;
}

function usablePreview(url: string | null, now: number): string | null {
  if (!url || !mediaHostAllowed(url) || signedUrlExpired(url, now)) return null;
  return url;
}

function storeImage(creatorId: string, mediaId: string, media: MediaBytes | null): MediaBytes | null {
  if (!media?.body || !imageBytes(media.body, media.contentType)) return null;
  putVaultThumb(creatorId, mediaId, media.body, media.contentType);
  return media;
}

function imageBytes(body: Uint8Array, contentType: string): boolean {
  const type = contentType.split(";")[0]?.trim() ?? "";
  return body.byteLength > 0 && body.byteLength <= THUMB_MAX_BYTES && type.startsWith("image/") && !type.startsWith("text/");
}

async function fetchThumb(
  fetchImpl: typeof fetch,
  target: string,
  headers: Record<string, string>,
): Promise<{ status: number; body: Uint8Array | null; contentType: string }> {
  if (!mediaHostAllowed(target)) return { status: 0, body: null, contentType: "" };
  let response: Response;
  try {
    response = await fetchImpl(target, { headers, redirect: "manual", signal: AbortSignal.timeout(8_000) });
  } catch {
    return { status: 0, body: null, contentType: "" };
  }
  if (response.status >= 300 && response.status < 400) {
    const next = nextMediaUrl(target, response.headers.get("location"));
    await response.body?.cancel().catch(() => undefined);
    if (!next) return { status: response.status, body: null, contentType: "" };
    try {
      response = await fetchImpl(next, { headers, redirect: "manual", signal: AbortSignal.timeout(8_000) });
    } catch {
      return { status: 0, body: null, contentType: "" };
    }
  }
  if (!response.ok) {
    const status = response.status;
    await response.body?.cancel().catch(() => undefined);
    return { status, body: null, contentType: "" };
  }
  const raw = new Uint8Array(await response.arrayBuffer());
  const type = (response.headers.get("content-type") ?? "").split(";")[0]?.trim() ?? "";
  if (!imageBytes(raw, type)) return { status: response.status, body: null, contentType: type };
  return { status: response.status, body: raw, contentType: type };
}

function unixSeconds(raw: string): number | null {
  if (!/^\d{9,13}$/.test(raw)) return null;
  const value = Number(raw);
  const seconds = raw.length >= 13 ? Math.floor(value / 1000) : value;
  if (seconds < 1_000_000_000 || seconds > 4_000_000_000) return null;
  return seconds;
}

function policyEpoch(policy: string): number | null {
  try {
    const padded = policy.replace(/-/g, "+").replace(/_/g, "/");
    const json = Buffer.from(padded, "base64").toString("utf8");
    return walkEpoch(JSON.parse(json) as unknown);
  } catch {
    return null;
  }
}

function walkEpoch(value: unknown): number | null {
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = walkEpoch(item);
      if (found != null) return found;
    }
    return null;
  }
  const record = value as Record<string, unknown>;
  const direct = record["AWS:EpochTime"];
  if (typeof direct === "number" && Number.isFinite(direct)) return direct;
  for (const item of Object.values(record)) {
    const found = walkEpoch(item);
    if (found != null) return found;
  }
  return null;
}
