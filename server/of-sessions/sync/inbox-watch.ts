import type { BrowserContext, Page } from "playwright";
import { chatPageUrl, classifyChatPath, parseChatMessages, parsePreviewMessages, type ChatMessage } from "./chats.ts";
import { parseLivePayload } from "./live-frames.ts";
import { planWatch } from "./watch-plan.ts";

export type WatchTarget = {
  accountId: string;
  creatorId: string;
  threadKey: string | null;
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
 * Una pestaña abierta. No envía frames ni llama a la API: solo navega
 * cuando cambia el hilo y escucha lo que la página recibe.
 */
export async function runInboxWatch(input: {
  stopped: () => boolean;
  target: () => WatchTarget | null;
  open: (accountId: string) => Promise<WatchSession>;
  save: (creatorId: string, messages: ChatMessage[]) => Promise<void>;
  onBlock: (accountId: string, reason: string) => void;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  paceMs?: number;
  blockMs?: number;
}): Promise<void> {
  let session: WatchSession | null = null;
  let pageOpen = false;
  let pageThread: string | null = null;
  let accountId: string | null = null;
  let creatorId: string | null = null;
  let lastNavAt: number | null = null;
  let lastUsefulAt: number | null = null;
  let lastReloadAt: number | null = null;
  let lastWatcherAt = input.now();
  let blockedUntil: number | null = null;

  const shut = async () => {
    if (!session) return;
    await session.close();
    session = null;
    pageOpen = false;
    pageThread = null;
  };

  while (!input.stopped()) {
    const target = input.target();
    const now = input.now();
    if (target && target.watchers > 0) lastWatcherAt = now;
    const action = planWatch({
      watchers: target?.watchers ?? 0,
      wantedThread: target?.threadKey ?? null,
      pageThread,
      pageOpen,
      lastNavAt,
      lastUsefulAt,
      lastReloadAt,
      lastWatcherAt,
      now,
      blockedUntil,
      paceMs: input.paceMs,
    });
    if (action === "close") {
      await shut();
      if (!target || target.watchers <= 0) break;
    }
    if ((action === "open" || action === "navigate" || action === "reload") && target) {
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
        pageOpen = true;
        const current = () => creatorId;
        session.listen({
          onMessages: (messages) => {
            lastUsefulAt = input.now();
            const id = current();
            if (id && messages.length) void input.save(id, messages);
          },
          onBlock: (reason) => {
            blockedUntil = input.now() + (input.blockMs ?? 15_000);
            if (accountId) input.onBlock(accountId, reason);
          },
        });
      }
      const url = target.threadKey
        ? chatPageUrl(target.chatsUrl, target.threadKey, target.siteId)
        : target.chatsUrl;
      const status = await session.goto(url);
      lastNavAt = input.now();
      if (action === "reload") lastReloadAt = input.now();
      pageThread = target.threadKey;
      if (status === 403 || status === 429) {
        blockedUntil = input.now() + (input.blockMs ?? 15_000);
        input.onBlock(target.accountId, String(status));
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
  const page = await context.newPage();
  return watchPage(page, threadKey);
}
