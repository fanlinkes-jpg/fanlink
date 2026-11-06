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

export function canProxyMedia(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
    const path = parsed.pathname.toLowerCase();
    if (path.includes("/api2/") || path.includes("/api/")) return false;
    return true;
  } catch {
    return false;
  }
}

export function olderThan(messages: ChatMessage[], cursorSentAt: string | null, limit: number): ChatMessage[] {
  const pool = cursorSentAt ? messages.filter((message) => message.sentAt < cursorSentAt) : messages;
  return [...pool].sort((left, right) => right.sentAt.localeCompare(left.sentAt)).slice(0, limit).reverse();
}
