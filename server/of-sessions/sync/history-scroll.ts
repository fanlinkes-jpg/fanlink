import type { Page } from "playwright";
import { parseChatList, parseChatMessages, type ChatMessage, type ChatThread } from "./chats.ts";

/**
 * Sube el hilo nativo. No pide la API: espera el JSON que la página
 * dispara al hacer scroll.
 */
export async function captureOlderMessages(
  page: Page,
  input: { threadKey: string; fanKey: string | null; accountUserId: string | null; waitMs?: number },
): Promise<ChatMessage[]> {
  const payloads: string[] = [];
  const onResponse = (response: { url(): string; status(): number; text(): Promise<string> }) => {
    if (response.status() < 200 || response.status() >= 300) return;
    if (!isMessagePath(response.url())) return;
    void response.text().then((text) => {
      if (text.length <= 1_500_000) payloads.push(text);
    }).catch(() => undefined);
  };
  page.on("response", onResponse);
  try {
    await page.locator("[data-fanlink-history], .b-chat__messages").first().evaluate((node) => {
      if (node instanceof HTMLElement) node.scrollTop = 0;
    });
    const deadline = Date.now() + (input.waitMs ?? 4_000);
    while (Date.now() <= deadline) {
      const parsed = payloads.flatMap((payload) => parsePayload(payload, input));
      if (parsed.length > 0) return parsed;
      await delay(120);
    }
    return [];
  } finally {
    page.off("response", onResponse);
  }
}

export async function captureChatListPage(page: Page, accountUserId: string | null, waitMs = 4_000): Promise<ChatThread[]> {
  const payloads: string[] = [];
  const onResponse = (response: { url(): string; status(): number; text(): Promise<string> }) => {
    if (response.status() < 200 || response.status() >= 300) return;
    if (!isListPath(response.url())) return;
    void response.text().then((text) => {
      if (text.length <= 1_500_000) payloads.push(text);
    }).catch(() => undefined);
  };
  page.on("response", onResponse);
  try {
    await page.locator("[data-fanlink-chats]").first().evaluate((node) => {
      if (node instanceof HTMLElement) node.scrollTop = node.scrollHeight;
    });
    const deadline = Date.now() + waitMs;
    while (Date.now() <= deadline) {
      const threads = payloads.flatMap((payload) => {
        try {
          return parseChatList(JSON.parse(payload) as unknown, accountUserId);
        } catch {
          return [];
        }
      });
      if (threads.length > 0) return threads;
      await delay(120);
    }
    return [];
  } finally {
    page.off("response", onResponse);
  }
}

function parsePayload(
  payload: string,
  input: { threadKey: string; fanKey: string | null; accountUserId: string | null },
): ChatMessage[] {
  try {
    return parseChatMessages(JSON.parse(payload) as unknown, input.threadKey, input.fanKey, input.accountUserId);
  } catch {
    return [];
  }
}

function isMessagePath(raw: string): boolean {
  try {
    const path = new URL(raw).pathname.toLowerCase();
    return path.includes("/api2/") && path.includes("/messages") && path.includes("/chat");
  } catch {
    return false;
  }
}

function isListPath(raw: string): boolean {
  try {
    const path = new URL(raw).pathname.toLowerCase();
    return path.endsWith("/chats") || path.endsWith("/chats/");
  } catch {
    return false;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
