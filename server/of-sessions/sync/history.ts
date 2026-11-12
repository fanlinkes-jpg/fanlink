import type { ChatMedia, ChatMessage, ChatThread } from "./chats.ts";

export type HistoryThread = {
  threadKey: string;
  cursor: string | null;
  done: boolean;
};

/** El cursor es el mensaje más antiguo ya guardado. Sin mensajes no hay cursor. */
export function oldestCursor(messages: Array<{ messageKey: string; sentAt: string }>): string | null {
  const ordered = [...messages].sort((left, right) => left.sentAt.localeCompare(right.sentAt));
  return ordered[0]?.messageKey ?? null;
}

/** Una página que no trae nada más antiguo que el cursor cierra el histórico. */
export function pageFinished(previousCursor: string | null, incoming: Array<{ messageKey: string; sentAt: string }>): boolean {
  if (incoming.length === 0) return true;
  if (!previousCursor) return false;
  return incoming.every((message) => message.messageKey === previousCursor);
}

export function nextHistoryThread(threads: HistoryThread[]): HistoryThread | null {
  return threads.find((thread) => !thread.done) ?? null;
}

export function historyPerMinute(raw: string | undefined): number {
  if (raw == null || raw.trim() === "") return 6;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 30) return 6;
  return value;
}

export function paidLabel(cents: number | null, paid: boolean | null): string | null {
  if (cents == null || cents <= 0 || paid == null) return null;
  if (paid) return `$${(cents / 100).toFixed(2)} paid`;
  return "not paid";
}

export function purchaseLine(cents: number | null): string {
  if (cents == null) return "Purchased — has purchased your message";
  return `Purchased — has purchased your message for $${(cents / 100).toFixed(2)}`;
}

export function tipLine(cents: number | null): string {
  if (cents == null) return "Tip";
  return `Tip — $${(cents / 100).toFixed(2)}`;
}

export function listPageDone(previous: string[], incoming: ChatThread[]): boolean {
  if (incoming.length === 0) return true;
  const known = new Set(previous);
  return incoming.every((thread) => known.has(thread.threadKey));
}

export function mediaSummary(media: ChatMedia[] | null | undefined): { count: number | null; seconds: number | null; preview: string | null } {
  if (!media || media.length === 0) return { count: null, seconds: null, preview: null };
  const seconds = media.reduce((sum, item) => sum + (item.seconds ?? 0), 0);
  return {
    count: media.length,
    seconds: media.some((item) => item.seconds != null) ? seconds : null,
    preview: media.find((item) => item.preview)?.preview ?? null,
  };
}

export function encodeMedia(media: ChatMedia[] | null | undefined): string | null {
  if (!media || media.length === 0) return null;
  return JSON.stringify(media);
}

export function decodeMedia(raw: string | null): ChatMedia[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    return parsed.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const row = item as ChatMedia;
      return [row];
    });
  } catch {
    return null;
  }
}

/** Hosts de OnlyFans y su CDN. Un redirect a otro sitio no se sigue. */
export function mediaHostAllowed(raw: string): boolean {
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
    const host = parsed.hostname.toLowerCase();
    if (host !== "onlyfans.com" && !host.endsWith(".onlyfans.com")) return false;
    const path = parsed.pathname.toLowerCase();
    return !path.includes("/api2/") && !path.includes("/api/");
  } catch {
    return false;
  }
}

export function nextMediaUrl(current: string, location: string | null): string | null {
  if (!location) return null;
  try {
    const next = new URL(location, current);
    const href = next.toString();
    if (mediaHostAllowed(href)) return href;
    const host = next.hostname.toLowerCase();
    if (host.endsWith(".amazonaws.com") || host.endsWith(".cloudfront.net")) return href;
    return null;
  } catch {
    return null;
  }
}

export function canProxyMedia(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
    const path = parsed.pathname.toLowerCase();
    return !path.includes("/api2/") && !path.includes("/api/");
  } catch {
    return false;
  }
}

export const PREVIEW_MAX_BYTES = 5_000_000;
export const PREVIEW_TIMEOUT_MS = 8_000;

/** Lee como mucho el tope y deja de pedir en cuanto se pasa. El silencio también corta. */
export async function readCappedBytes(
  body: ReadableStream<Uint8Array> | null,
  maxBytes = PREVIEW_MAX_BYTES,
  idleMs = PREVIEW_TIMEOUT_MS,
): Promise<Uint8Array | null> {
  if (!body) return null;
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let seen = 0;
  try {
    for (;;) {
      const next = await new Promise<ReadableStreamReadResult<Uint8Array>>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("inactivo")), idleMs);
        reader.read().then((value) => {
          clearTimeout(timer);
          resolve(value);
        }, (error: unknown) => {
          clearTimeout(timer);
          reject(error);
        });
      });
      if (next.done) break;
      seen += next.value.byteLength;
      if (seen > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(next.value);
    }
  } catch {
    await reader.cancel().catch(() => undefined);
    return null;
  }
  const out = new Uint8Array(seen);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

export async function followMedia(
  start: string,
  load: (url: string) => Promise<{ status: number; location: string | null; body: Uint8Array | null }>,
  timeoutMs = PREVIEW_TIMEOUT_MS,
): Promise<Uint8Array | null> {
  let current = start;
  for (let hop = 0; hop < 3; hop += 1) {
    if (!mediaHostAllowed(current)) return null;
    const response = await new Promise<{ status: number; location: string | null; body: Uint8Array | null } | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), timeoutMs);
      load(current).then((value) => {
        clearTimeout(timer);
        resolve(value);
      }, () => {
        clearTimeout(timer);
        resolve(null);
      });
    });
    if (!response) return null;
    if (response.status >= 300 && response.status < 400) {
      const next = nextMediaUrl(current, response.location);
      if (!next) return null;
      current = next;
      continue;
    }
    if (response.status < 200 || response.status >= 300 || !response.body) return null;
    if (response.body.byteLength === 0 || response.body.byteLength > PREVIEW_MAX_BYTES) return null;
    return response.body;
  }
  return null;
}

export function olderThan(messages: ChatMessage[], cursorSentAt: string | null, limit: number): ChatMessage[] {
  const pool = cursorSentAt ? messages.filter((message) => message.sentAt < cursorSentAt) : messages;
  return [...pool].sort((left, right) => right.sentAt.localeCompare(left.sentAt)).slice(0, limit).reverse();
}
