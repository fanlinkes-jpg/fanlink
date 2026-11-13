import type { BrowserContext, Page } from "playwright";
import { closeIfIdle } from "../live/pages.ts";
import { isCurrentUserResponseUrl, isLoginChallengeUrl, jsonUrlWithoutSecrets, usersMeVerdict } from "../identity.ts";
import { messages } from "../messages.ts";
import type { SiteAdapter } from "../sessions/site.ts";
import type { StorageCookie } from "../sessions/storage-state.ts";
import {
  applyAccountId,
  applyUserDirectory,
  chatFailureReason,
  chatPageUrl,
  classifyChatPath,
  isUsersDirectoryUrl,
  mergeMessages,
  mergeThreads,
  mergeUsers,
  parseChatDom,
  parseChatList,
  parseChatMessages,
  parsePreviewMessages,
  parseUsersDirectory,
  threadsToOpen,
  type ChatMessage,
  type ChatThread,
  type ChatUser,
} from "./chats.ts";
import { outcomeFromParsed, preferOutcome, type SectionOutcome } from "./parse.ts";
import { logUnparsed, shapeSummary } from "./shape.ts";
import { logApiResponse, logSection, sectionWaitMs, settleUntil } from "./wait-for-data.ts";

export type CollectedChats = {
  threads: ChatThread[];
  messages: ChatMessage[];
  reason: string | null;
  jsonPaths: string[];
  loginRequired?: boolean;
  alreadyRunning?: boolean;
  /** 401 de la API firmada. No abre Chromium. */
  sessionRejected?: boolean;
  /** Espera de un 429. */
  retryAfterMs?: number;
  /** Set-Cookie parseadas. Persistirlas es el encargo 1-1; aquí no se escriben. */
  rotatedCookies?: StorageCookie[];
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
    loginRequired: false,
    sawLoggedIn: false,
    pageLogin: false,
    outcome: "pending" as SectionOutcome,
    listUrl: null as string | null,
    messageOutcome: "pending" as SectionOutcome,
    messageUrl: null as string | null,
    users: [] as ChatUser[],
    sawDirectory: false,
    threadsSeenAt: null as number | null,
    chatShape: null as string | null,
    messageShape: null as string | null,
    userShape: null as string | null,
    accountId: null as string | null,
  };
  const pending: Promise<void>[] = [];
  const onResponse = (response: { url(): string; status(): number; headers(): Record<string, string>; text(): Promise<string> }) => {
    pending.push(observe(response, notes));
  };
  context.on("response", onResponse);
  let page: Page | undefined;
  try {
    page = await context.newPage();
    if (!site.chatsUrl) {
      return { threads: [], messages: [], reason: "sin respuesta de chats", jsonPaths: [] };
    }
    if (site.id === "onlyfans") {
      await openChat(page, site.probeUrl, options, notes, pending, site, () => notes.sawLoggedIn);
      if (notes.sawLoggedIn && !notes.loginRequired) {
        notes.redirected = false;
        await openChat(page, site.chatsUrl, options, notes, pending, site, () => chatsReady(notes));
        notes.pageLogin = notes.redirected;
        if (notes.pageLogin) notes.redirected = false;
        logSection("chat", "chats", page.url(), notes.listUrl, notes.threads.length);
      } else {
        notes.loginRequired = true;
      }
    } else {
      await openChat(page, site.chatsUrl, options, notes, pending, site, () => chatsReady(notes));
      logSection("chat", "chats", page.url(), notes.listUrl, notes.threads.length);
    }
    const threads = threadsToOpen(notes.threads);
    const threadBudget = site.id === "onlyfans" ? 10_000 : options.waitMs;
    for (const thread of threads) {
      if (notes.redirected || notes.pageLogin || notes.loginRequired) break;
      resetMessageRead(notes);
      const url = chatPageUrl(site.chatsUrl, thread.threadKey, site.id);
      const before = notes.messages.filter((message) => message.threadKey === thread.threadKey).length;
      await delay(options.paceMs);
      await openChat(
        page,
        url,
        options,
        notes,
        pending,
        site,
        () => notes.messages.filter((message) => message.threadKey === thread.threadKey).length > before,
        threadBudget,
      );
      const count = notes.messages.filter((message) => message.threadKey === thread.threadKey).length;
      console.info(`[fanlink:chat] mensajes chat=${thread.threadKey} registros=${count}`);
      if (notes.messageOutcome === "changed" && notes.messageShape) {
        console.info(`[fanlink:chat] forma mensajes chat=${thread.threadKey} ${notes.messageShape}`);
      }
    }
    if (notes.threads.length === 0 && notes.outcome === "pending") {
      const markers = await page.evaluate(readChatMarkers).catch(() => null);
      if (markers) {
        const dom = parseChatDom(markers.threads, markers.messages);
        notes.threads = dom.threads;
        notes.messages = dom.messages;
        if (dom.threads.length || dom.messages.length) notes.outcome = preferOutcome(notes.outcome, "ok");
      }
    }
    logUnparsed("chat", "chats", notes.outcome, notes.chatShape);
    if (!notes.sawDirectory && notes.userShape) console.info(`[fanlink:chat] forma usuarios ${notes.userShape}`);
    const loginRequired = site.id === "onlyfans" && !notes.sawLoggedIn && (notes.loginRequired || notes.redirected);
    const reason = loginRequired
      ? messages.loginRequired
      : notes.pageLogin
        ? "la página de chats pidió login"
        : chatFailureReason({
          redirected: notes.redirected,
          outcome: notes.outcome,
          jsonPaths: notes.paths,
        });
    if (reason) {
      console.info(`[fanlink:chat] ${reason}${notes.paths.length ? ` | json: ${notes.paths.join(", ")}` : ""}`);
    }
    return {
      threads: notes.threads.slice(0, 200),
      messages: notes.messages.slice(0, 200),
      reason,
      jsonPaths: notes.paths,
      loginRequired,
    };
  } finally {
    context.off("response", onResponse);
    if (page) await closeIfIdle(page);
  }
}

async function openChat(
  page: Page,
  url: string,
  options: { paceMs: number; waitMs: number },
  notes: { redirected: boolean },
  pending: Promise<void>[],
  site: SiteAdapter,
  ready: () => boolean,
  budgetMs?: number,
): Promise<void> {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => undefined);
  if (site.isLoginUrl(page.url())) {
    notes.redirected = true;
    return;
  }
  await settleUntil({
    budgetMs: budgetMs ?? sectionWaitMs(site.id, options.waitMs),
    paceMs: options.paceMs,
    ready,
    scroll: true,
    wheel: async (dy) => {
      await page.mouse.wheel(0, dy).catch(() => undefined);
      await page.mouse.move(420 + (dy % 70), 280).catch(() => undefined);
    },
    pause: delay,
    drain: () => drain(pending),
  });
  if (site.isLoginUrl(page.url())) notes.redirected = true;
  const login = site.loggedOutSelector
    ? await page.locator(`${site.loggedOutSelector}:visible`).count().catch(() => 0)
    : 0;
  if (login > 0) notes.redirected = true;
}

async function observe(
  response: { url(): string; status(): number; headers(): Record<string, string>; text(): Promise<string> },
  notes: {
    paths: string[];
    threads: ChatThread[];
    messages: ChatMessage[];
    outcome: SectionOutcome;
    listUrl: string | null;
    messageOutcome: SectionOutcome;
    messageUrl: string | null;
    users: ChatUser[];
    sawDirectory: boolean;
    threadsSeenAt: number | null;
    chatShape: string | null;
    messageShape: string | null;
    userShape: string | null;
    accountId: string | null;
    loginRequired: boolean;
    sawLoggedIn: boolean;
  },
): Promise<void> {
  let url = "";
  try {
    url = response.url();
    logApiResponse("chat", url, response.status());
    if (isLoginChallengeUrl(url)) notes.loginRequired = true;
    const kind = classifyChatPath(url);
    const type = (response.headers()["content-type"] ?? "").toLowerCase();
    const path = jsonUrlWithoutSecrets(url);
    const usersMe = isCurrentUserResponseUrl(url);
    if (path && (type.includes("json") || kind !== "other" || usersMe) && !notes.paths.includes(path) && notes.paths.length < 20) {
      notes.paths.push(path);
    }
    if (usersMe && (!type || type.includes("json") || type.includes("text"))) {
      const rawUser = await response.text();
      if (rawUser.length <= 1_500_000) {
        const verdict = usersMeVerdict(JSON.parse(rawUser) as unknown);
        if (verdict.kind === "logged_in") {
          notes.sawLoggedIn = true;
          notes.loginRequired = false;
          if (verdict.identity.userId) {
            notes.accountId = verdict.identity.userId;
            const refreshed = applyAccountId(notes.threads, notes.messages, notes.accountId);
            notes.threads = refreshed.threads;
            notes.messages = refreshed.messages;
          }
        } else if (verdict.kind === "guest") {
          notes.sawLoggedIn = false;
          notes.loginRequired = true;
        }
      }
      return;
    }
    if (isUsersDirectoryUrl(url)) {
      const rawUsers = await response.text();
      if (rawUsers.length > 1_500_000) return;
      const parsedUsers = JSON.parse(rawUsers) as unknown;
      const users = parseUsersDirectory(parsedUsers);
      if (users.length) {
        notes.users = mergeUsers(notes.users, users);
        notes.sawDirectory = true;
        notes.threads = applyUserDirectory(notes.threads, notes.users);
      } else if (!notes.userShape) {
        notes.userShape = shapeSummary(parsedUsers);
      }
      return;
    }
    if (kind === "other") return;
    const safe = jsonUrlWithoutSecrets(url);
    if (type && !type.includes("json") && !type.includes("text")) {
      rememberChat(notes, kind, safe, "changed", null);
      return;
    }
    const raw = await response.text();
    if (raw.length > 1_500_000) {
      rememberChat(notes, kind, safe, "changed", null);
      return;
    }
    const parsed = JSON.parse(raw) as unknown;
    if (kind === "list") {
      const threads = parseChatList(parsed, notes.accountId);
      const previews = parsePreviewMessages(parsed, notes.accountId);
      if (threads.length) {
        if (notes.threadsSeenAt == null) notes.threadsSeenAt = Date.now();
        notes.threads = applyUserDirectory(mergeThreads(notes.threads, threads), notes.users);
      }
      if (previews.length) notes.messages = mergeMessages(notes.messages, previews);
      rememberChat(notes, kind, safe, outcomeFromParsed(threads.length, parsed), parsed);
      return;
    }
    const threadKey = threadKeyFromUrl(url) ?? notes.threads[0]?.threadKey ?? "chat";
    const fanKey = notes.threads.find((thread) => thread.threadKey === threadKey)?.fanKey ?? notes.threads[0]?.fanKey ?? null;
    const messages = parseChatMessages(parsed, threadKey, fanKey, notes.accountId);
    if (messages.length) notes.messages = mergeMessages(notes.messages, messages);
    rememberChat(notes, kind, safe, outcomeFromParsed(messages.length, parsed), parsed);
  } catch {
    if (!url) return;
    const kind = classifyChatPath(url);
    if (kind === "other") return;
    rememberChat(notes, kind, jsonUrlWithoutSecrets(url), "changed", null);
  }
}

function resetMessageRead(notes: { messageOutcome: SectionOutcome; messageShape: string | null }): void {
  notes.messageOutcome = "pending";
  notes.messageShape = null;
}

function chatsReady(notes: { threads: ChatThread[]; sawDirectory: boolean; threadsSeenAt: number | null }): boolean {
  if (notes.threads.length === 0) return false;
  if (notes.sawDirectory || notes.threads.every((thread) => thread.fanName || thread.fanHandle)) return true;
  if (notes.threadsSeenAt == null) return false;
  return Date.now() - notes.threadsSeenAt >= 3_000;
}

function rememberChat(
  notes: {
    outcome: SectionOutcome;
    listUrl: string | null;
    messageOutcome: SectionOutcome;
    messageUrl: string | null;
    chatShape: string | null;
    messageShape: string | null;
  },
  kind: "list" | "messages",
  path: string | null,
  outcome: SectionOutcome,
  payload: unknown,
): void {
  if (kind === "list") {
    notes.outcome = preferOutcome(notes.outcome, outcome);
    if (!notes.listUrl && path) notes.listUrl = path;
    if (outcome === "changed" && payload != null && !notes.chatShape) notes.chatShape = shapeSummary(payload);
    return;
  }
  notes.messageOutcome = preferOutcome(notes.messageOutcome, outcome);
  if (!notes.messageUrl && path) notes.messageUrl = path;
  if (outcome === "changed" && payload != null && !notes.messageShape) notes.messageShape = shapeSummary(payload);
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
    for (const job of batch) await job;
  }
}
