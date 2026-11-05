import type { BrowserContext, Page } from "playwright";
import { jsonUrlWithoutSecrets } from "../identity.ts";
import type { SiteAdapter } from "../sessions/site.ts";
import {
  chatFailureReason,
  classifyChatPath,
  parseChatDom,
  parseChatList,
  parseChatMessages,
  type ChatMessage,
  type ChatThread,
} from "./chats.ts";

export type CollectedChats = {
  threads: ChatThread[];
  messages: ChatMessage[];
  reason: string | null;
  jsonPaths: string[];
  alreadyRunning?: boolean;
};

/**
 * Abre la página normal de chats. El listener va antes de navegar.
 * Como mucho abre dos hilos recientes. No envía mensajes.
 */
export async function collectChats(
  context: BrowserContext,
  site: SiteAdapter,
  options: { paceMs: number; waitMs: number },
): Promise<CollectedChats> {
  const notes = {
    paths: [] as string[],
    threads: [] as ChatThread[],
    messages: [] as ChatMessage[],
    redirected: false,
    sawUrl: false,
    parsed: false,
  };
  const pending: Promise<void>[] = [];
  const onResponse = (response: { url(): string; headers(): Record<string, string>; text(): Promise<string> }) => {
    pending.push(observe(response, notes));
  };
  context.on("response", onResponse);
  try {
    const page = await context.newPage();
    if (!site.chatsUrl) {
      return { threads: [], messages: [], reason: "sin respuesta de chats", jsonPaths: [] };
    }
    await openChat(page, site.chatsUrl, options, notes, pending, site);
    const threads = notes.threads.slice(0, 2);
    for (const thread of threads) {
      if (notes.redirected) break;
      const url = threadUrl(site.chatsUrl, thread.threadKey);
      await openChat(page, url, options, notes, pending, site);
    }
    if (notes.threads.length === 0) {
      const markers = await page.evaluate(readChatMarkers).catch(() => null);
      if (markers) {
        const dom = parseChatDom(markers.threads, markers.messages);
        notes.threads = dom.threads;
        notes.messages = dom.messages;
        if (dom.threads.length || dom.messages.length) notes.parsed = true;
      }
    }
    const reason = chatFailureReason({
      redirected: notes.redirected,
      sawUrl: notes.sawUrl,
      parsed: notes.parsed,
      jsonPaths: notes.paths,
    });
    if (reason) console.info(`[fanlink:chat] ${reason}`);
    return { threads: notes.threads.slice(0, 40), messages: notes.messages.slice(0, 80), reason, jsonPaths: notes.paths };
  } finally {
    context.off("response", onResponse);
  }
}

async function openChat(
  page: Page,
  url: string,
  options: { paceMs: number; waitMs: number },
  notes: { redirected: boolean },
  pending: Promise<void>[],
  site: SiteAdapter,
): Promise<void> {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => undefined);
  await Promise.race([
    page.waitForLoadState("networkidle", { timeout: options.waitMs }).catch(() => undefined),
    delay(options.waitMs),
  ]);
  await page.mouse.wheel(0, 500).catch(() => undefined);
  await delay(options.paceMs);
  await drain(pending);
  if (site.isLoginUrl(page.url())) notes.redirected = true;
  const login = site.loggedOutSelector ? await page.locator(site.loggedOutSelector).count().catch(() => 0) : 0;
  if (login > 0) notes.redirected = true;
}

async function observe(
  response: { url(): string; headers(): Record<string, string>; text(): Promise<string> },
  notes: {
    paths: string[];
    threads: ChatThread[];
    messages: ChatMessage[];
    sawUrl: boolean;
    parsed: boolean;
  },
): Promise<void> {
  let url = "";
  try {
    url = response.url();
    const kind = classifyChatPath(url);
    const type = (response.headers()["content-type"] ?? "").toLowerCase();
    const path = jsonUrlWithoutSecrets(url);
    if (path && (type.includes("json") || kind !== "other") && !notes.paths.includes(path) && notes.paths.length < 20) {
      notes.paths.push(path);
    }
    if (kind === "other") return;
    notes.sawUrl = true;
    if (type && !type.includes("json") && !type.includes("text")) return;
    const raw = await response.text();
    if (raw.length > 1_500_000) return;
    const parsed = JSON.parse(raw) as unknown;
    if (kind === "list") {
      const threads = parseChatList(parsed);
      if (threads.length) {
        notes.threads = threads;
        notes.parsed = true;
      }
      return;
    }
    const threadKey = threadKeyFromUrl(url) ?? notes.threads[0]?.threadKey ?? "chat";
    const fanKey = notes.threads.find((thread) => thread.threadKey === threadKey)?.fanKey ?? notes.threads[0]?.fanKey ?? null;
    const messages = parseChatMessages(parsed, threadKey, fanKey);
    if (messages.length) {
      notes.messages.push(...messages);
      notes.parsed = true;
    }
  } catch {
    if (url && classifyChatPath(url) !== "other") notes.sawUrl = true;
  }
}

export function readChatMarkers(): {
  threads: Array<{ id: string; fanId: string; handle: string; name: string; excerpt: string; at: string; unread: string }>;
  messages: Array<{ id: string; thread: string; fanId: string; from: string; body: string; at: string }>;
} {
  const threads: Array<{ id: string; fanId: string; handle: string; name: string; excerpt: string; at: string; unread: string }> = [];
  const messages: Array<{ id: string; thread: string; fanId: string; from: string; body: string; at: string }> = [];
  for (const node of document.querySelectorAll("[data-fanlink-chat]")) {
    threads.push({
      id: node.getAttribute("data-id") ?? "",
      fanId: node.getAttribute("data-fan-id") ?? "",
      handle: node.getAttribute("data-handle") ?? "",
      name: node.getAttribute("data-name") ?? "",
      excerpt: node.getAttribute("data-excerpt") ?? "",
      at: node.getAttribute("data-at") ?? "",
      unread: node.getAttribute("data-unread") ?? "",
    });
  }
  for (const node of document.querySelectorAll("[data-fanlink-message]")) {
    messages.push({
      id: node.getAttribute("data-id") ?? "",
      thread: node.getAttribute("data-thread") ?? "",
      fanId: node.getAttribute("data-fan-id") ?? "",
      from: node.getAttribute("data-from") ?? "",
      body: node.textContent ?? "",
      at: node.getAttribute("data-at") ?? "",
    });
  }
  return { threads: threads.slice(0, 20), messages: messages.slice(0, 40) };
}

function threadUrl(listUrl: string, threadKey: string): string {
  return `${listUrl.replace(/\/+$/, "")}/${encodeURIComponent(threadKey)}`;
}

function threadKeyFromUrl(url: string): string | null {
  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    const id = parts.find((part) => /^\d+$/.test(part));
    return id ?? null;
  } catch {
    return null;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function drain(pending: Promise<void>[]): Promise<void> {
  for (let turn = 0; turn < 5 && pending.length > 0; turn += 1) {
    const batch = pending.splice(0, pending.length);
    await Promise.all(batch);
  }
}
