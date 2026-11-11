import { parseChatMessages, parsePreviewMessages, type ChatMessage } from "./chats.ts";

export type LiveFrame = {
  messages: ChatMessage[];
  typing: boolean;
  read: boolean;
};

/** Escucha un frame ya recibido. No fabrica mensajes si el JSON no se reconoce. */
export function parseLivePayload(text: string, threadKey: string, fanKey: string | null, accountId: string | null = null): LiveFrame {
  const parsed = extractJson(text);
  if (parsed == null) return { messages: [], typing: false, read: false };
  const chunks = Array.isArray(parsed) ? parsed : [parsed];
  const messages = chunks.flatMap((chunk) => [
    ...parseChatMessages(chunk, threadKey, fanKey, accountId, "socket"),
    ...parsePreviewMessages(chunk),
  ]);
  return {
    messages: dedupe(messages),
    typing: hasTrue(parsed, "typing", 0) || hasTrue(parsed, "isTyping", 0),
    read: hasTrue(parsed, "isRead", 0) || hasTrue(parsed, "markRead", 0),
  };
}

function extractJson(text: string): unknown {
  const objectAt = text.indexOf("{");
  const arrayAt = text.indexOf("[");
  if (objectAt < 0 && arrayAt < 0) return null;
  const at = objectAt < 0 ? arrayAt : arrayAt < 0 ? objectAt : Math.min(objectAt, arrayAt);
  try {
    return JSON.parse(text.slice(at)) as unknown;
  } catch {
    return null;
  }
}

function hasTrue(value: unknown, key: string, depth: number): boolean {
  if (!value || typeof value !== "object" || depth > 4) return false;
  if (Array.isArray(value)) return value.some((item) => hasTrue(item, key, depth + 1));
  const record = value as Record<string, unknown>;
  if (record[key] === true) return true;
  return Object.values(record).some((child) => hasTrue(child, key, depth + 1));
}

function dedupe(messages: ChatMessage[]): ChatMessage[] {
  const map = new Map<string, ChatMessage>();
  for (const message of messages) map.set(message.messageKey, message);
  return [...map.values()];
}
