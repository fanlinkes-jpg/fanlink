import type { BrowserContext, Page } from "playwright";
import { openWorkPage } from "../sessions/work-page.ts";
import { chatPageUrl, classifyChatPath, parseChatMessages, parsePreviewMessages, type ChatMessage } from "./chats.ts";
import { parseLivePayload } from "./live-frames.ts";
import { FALLBACK_RELOAD_MS, nextFallbackThread, WATCH_IDLE_MS, type WatchedThread } from "./watch-plan.ts";

export type WatchTarget = {
  accountId: string;
  creatorId: string;
  threads: WatchedThread[];
  watchers: number;
  chatsUrl: string;
  siteId: string;
};

export type WatchSession = {
  goto(url: string): Promise<number>;
  listen(handlers: {
    onMessages: (messages: ChatMessage[]) => void;
    onBlock: (reason: string) => void;
  }): void;
  close(): Promise<void>;
};

/**
 * Una pestaña por cuenta. No envía frames ni llama a la API.
 * El WebSocket de esa página trae todos los chats. Sin socket, recarga
 * los hilos vigilados de uno en uno.
 */
export async function runInboxWatch(input: {
  stopped: () => boolean;
  target: () => WatchTarget | null;
  open: (accountId: string) => Promise<WatchSession>;
  save: (creatorId: string, messages: ChatMessage[]) => Promise<void>;
  /** Devuelve los milisegundos de la pausa de la cuenta. La pestaña espera eso, no un fijo de 15 s. */
  onBlock: (accountId: string, reason: string) => number;
  onNavigate?: (threadKey: string | null) => void;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  fallbackMs?: number;
  idleMs?: number;
}): Promise<void> {
  const fallbackMs = input.fallbackMs ?? FALLBACK_RELOAD_MS;
  const idleMs = input.idleMs ?? WATCH_IDLE_MS;
  let session: WatchSession | null = null;
  let pageThread: string | null = null;
  let accountId: string | null = null;
  let creatorId: string | null = null;
  let openedAt: number | null = null;
  let lastUsefulAt: number | null = null;
  let lastGlobalReloadAt: number | null = null;
  let lastWatcherAt = input.now();
  let blockedUntil: number | null = null;
  const reloadedAt = new Map<string, number>();

  const shut = async () => {
    if (!session) return;
    await session.close();
    session = null;
    pageThread = null;
    openedAt = null;
    reloadedAt.clear();
    input.onNavigate?.(null);
  };

  while (!input.stopped()) {
    const target = input.target();
    const now = input.now();
    if (target && target.watchers > 0) lastWatcherAt = now;
    if (blockedUntil != null && now < blockedUntil) {
      if (session) await shut();
      await input.sleep(200);
      continue;
    }
    if (!target || target.watchers <= 0) {
      if (now - lastWatcherAt >= idleMs) {
        await shut();
        break;
      }
      await input.sleep(200);
      continue;
    }
    if (!session || accountId !== target.accountId) {
      await shut();
      try {
        session = await input.open(target.accountId);
      } catch {
        await input.sleep(2_000);
        continue;
      }
      accountId = target.accountId;
      creatorId = target.creatorId;
      openedAt = input.now();
      const current = () => creatorId;
      session.listen({
        onMessages: (messages) => {
          lastUsefulAt = input.now();
          const id = current();
          const kept = messages.filter((message) => message.threadKey);
          if (id && kept.length) void input.save(id, kept);
        },
        onBlock: (reason) => {
          if (!accountId) return;
          blockedUntil = input.now() + input.onBlock(accountId, reason);
        },
      });
      input.onNavigate?.(null);
      const status = await session.goto(target.chatsUrl);
      if (status === 403 || status === 429) {
        blockedUntil = input.now() + input.onBlock(target.accountId, String(status));
        await shut();
        await input.sleep(200);
        continue;
      }
    }
    const quiet = lastUsefulAt == null || now - lastUsefulAt >= fallbackMs;
    const next = quiet
      ? nextFallbackThread(target.threads, reloadedAt, openedAt, lastGlobalReloadAt, now, fallbackMs)
      : null;
    if (next && session) {
      input.onNavigate?.(next);
      const status = await session.goto(chatPageUrl(target.chatsUrl, next, target.siteId));
      const at = input.now();
      lastGlobalReloadAt = at;
      reloadedAt.set(next, at);
      pageThread = next;
      if (status === 403 || status === 429) {
        blockedUntil = input.now() + input.onBlock(target.accountId, String(status));
        await shut();
      }
    }
    await input.sleep(200);
  }
  await shut();
}

export function watchPage(page: Page, threadKey: () => string): WatchSession {
  return {
    async goto(url: string) {
      const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => null);
      return response?.status() ?? 0;
    },
    listen({ onMessages, onBlock }) {
      page.on("websocket", (socket) => {
        socket.on("framereceived", (frame) => {
          const text = typeof frame.payload === "string" ? frame.payload : frame.payload.toString("utf8");
          const key = threadKey();
          const parsed = parseLivePayload(text, key, key);
          if (parsed.messages.length) onMessages(parsed.messages);
        });
      });
      page.on("response", (response) => {
        const status = response.status();
        if (status === 403 || status === 429) onBlock(String(status));
        const kind = classifyChatPath(response.url());
        if (kind === "other") return;
        void response.text().then((raw) => {
          if (raw.length > 1_500_000) return;
          const body = JSON.parse(raw) as unknown;
          const key = threadKey();
          const messages = kind === "list" ? parsePreviewMessages(body) : parseChatMessages(body, key, key);
          if (messages.length) onMessages(messages);
        }).catch(() => undefined);
      });
    },
    close: () => page.close().catch(() => undefined),
  };
}

export async function openWatchContext(context: BrowserContext, threadKey: () => string): Promise<WatchSession> {
  const page = await openWorkPage(context);
  return watchPage(page, threadKey);
}
