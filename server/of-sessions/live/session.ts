import type { BrowserContext, CDPSession, FileChooser, Frame, Page, Response, Route } from "playwright";
import { chatPageUrl } from "../sync/chats.ts";
import { parseChatMessages } from "../sync/chats.ts";
import { openWorkPage } from "../sessions/work-page.ts";
import { markLivePage } from "./pages.ts";
import { deskCommand, liveControlAllowed, liveHistoryGuardSource, liveLog, liveQuality, liveRequestAllowed, liveSocketGuardSource, liveThreadClick, liveTypingEnabled, mapPointer, type DeskInput } from "./desk.ts";
import { liveSectionPageUrl, type LiveSection } from "./sections.ts";
import { BROWSER_FINGERPRINT } from "../sessions/browser-factory.ts";
import { isLiveChallengeText, LIVE_CHALLENGE_NOTICE } from "./challenge.ts";

export type LiveFrame = { jpeg: Buffer; width: number; height: number };

export type LiveCast = {
  send(input: DeskInput): Promise<void>;
  acceptFile(file: { name: string; mimeType: string; buffer: Buffer } | null): void;
  stop(): Promise<void>;
};

export async function startLiveCast(input: {
  context: BrowserContext;
  accountId: string;
  threadKey: string;
  fanKey: string | null;
  accountUserId: string | null;
  section?: LiveSection;
  onFrame: (frame: LiveFrame) => void;
  onFile: () => void;
  onOwnMessage: (message: { messageId: string; body: string; priceCents: number | null; sentAt: string }) => void;
  onNotice?: (reason: string) => void;
}): Promise<LiveCast> {
  const fps = liveFpsFromEnv();
  const quality = liveQuality(process.env.FANLINK_LIVE_QUALITY);
  const section: LiveSection = input.section ?? "chat";
  const needle = section === "notifications" ? "/my/notifications" : "/my/chats";
  const open = input.context.pages().find((page) => {
    try {
      return page.url().includes(needle);
    } catch {
      return false;
    }
  });
  const page = open ?? await openWorkPage(input.context);
  markLivePage(page);
  const typing = liveTypingEnabled();
  const chatUrl = section === "chat"
    ? chatPageUrl("https://onlyfans.com/my/chats", input.threadKey, "onlyfans")
    : liveSectionPageUrl(section);
  const fingerprint = BROWSER_FINGERPRINT.viewport;
  let viewport: { width: number; height: number } = { width: fingerprint.width, height: fingerprint.height };
  let cdp: CDPSession | null = null;
  let stopped = false;
  let challengeOpen = false;
  let fileWait: ((file: { name: string; mimeType: string; buffer: Buffer } | null) => void) | null = null;
  console.info(liveLog("inicio", { accountId: input.accountId, fps }));
  await page.addInitScript({ content: liveHistoryGuardSource(chatUrl, section) });
  await page.addInitScript({ content: liveSocketGuardSource(typing) });
  cdp = await input.context.newCDPSession(page);
  const guardRoute = (route: Route) => {
    if (liveRequestAllowed(route.request().url(), route.request().method(), typing, section)) return route.continue();
    return route.abort();
  };
  await page.route("**/*", guardRoute);
  page.on("popup", (popup) => {
    void popup.route("**/*", (inner) => inner.abort()).finally(() => {
      void popup.close().catch(() => undefined);
    });
  });
  page.on("download", (download) => {
    void download.cancel().catch(() => undefined);
  });
  let goingHome = false;
  const onNavigated = (frame: Frame) => {
    if (frame !== page.mainFrame() || goingHome) return;
    const url = frame.url();
    if (!url || url === "about:blank" || url.startsWith("chrome-error:")) return;
    if (liveRequestAllowed(url, "GET", typing, section)) return;
    goingHome = true;
    void page.goto(chatUrl, { waitUntil: "domcontentloaded" }).catch(() => undefined).finally(() => {
      goingHome = false;
    });
  };
  page.on("framenavigated", onNavigated);
  page.on("filechooser", (chooser: FileChooser) => {
    if (!typing) {
      void chooser.setFiles([]).catch(() => undefined);
      return;
    }
    input.onFile();
    const wait = new Promise<{ name: string; mimeType: string; buffer: Buffer } | null>((resolve) => {
      fileWait = resolve;
    });
    void Promise.race([
      wait,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 20_000)),
    ]).then((file) => {
      fileWait = null;
      if (file) return chooser.setFiles(file);
      return chooser.setFiles([]);
    }).catch(() => undefined);
  });
  const onResponse = (response: Response) => {
    if (response.status() < 200 || response.status() >= 300) return;
    const path = pathOf(response.url());
    if (!path.includes("message") && !path.includes("chat")) return;
    void response.text().then((text) => {
      const messages = parseChatMessages(JSON.parse(text) as unknown, input.threadKey, input.fanKey, input.accountUserId);
      for (const message of messages) {
        if (message.fromFan) continue;
        input.onOwnMessage({ messageId: message.messageKey, body: message.body, priceCents: message.priceCents, sentAt: message.sentAt });
      }
    }).catch(() => undefined);
  };
  page.on("response", onResponse);
  const currentViewport = page.viewportSize();
  if (!currentViewport || currentViewport.width !== viewport.width || currentViewport.height !== viewport.height) {
    await page.setViewportSize(viewport);
  }
  const readChallenge = async () => {
    const [title, body] = await Promise.all([
      page.title().catch(() => ""),
      page.locator("body").innerText({ timeout: 2_000 }).catch(() => ""),
    ]);
    if (stopped) return;
    challengeOpen = isLiveChallengeText(`${title}\n${body}`);
    input.onNotice?.(challengeOpen ? LIVE_CHALLENGE_NOTICE : "");
  };
  const onChallengeFrame = (frame: Frame) => {
    if (frame !== page.mainFrame()) return;
    void readChallenge();
  };
  page.on("framenavigated", onChallengeFrame);
  await page.goto(chatUrl, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => undefined);
  await readChallenge();
  const challengeTimer = setInterval(() => {
    void readChallenge();
  }, 4_000);
  challengeTimer.unref?.();
  let lastFrame = 0;
  let sawFrame = false;
  cdp.on("Page.screencastFrame", (event: { data: string; sessionId: number; metadata?: { deviceWidth?: number; deviceHeight?: number } }) => {
    void cdp?.send("Page.screencastFrameAck", { sessionId: event.sessionId }).catch(() => undefined);
    const now = Date.now();
    if (now - lastFrame < Math.round(1000 / fps)) return;
    lastFrame = now;
    if (event.metadata?.deviceWidth && event.metadata.deviceHeight) {
      viewport = { width: event.metadata.deviceWidth, height: event.metadata.deviceHeight };
    }
    input.onFrame({ jpeg: Buffer.from(event.data, "base64"), width: viewport.width, height: viewport.height });
    if (!sawFrame) {
      sawFrame = true;
      console.info(liveLog("inicio", { accountId: input.accountId, detail: "imagen" }));
    }
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality, everyNthFrame: 1 });

  return {
    async send(command) {
      if (stopped || !cdp) return;
      if (challengeOpen) {
        const allowed = deskCommand(command, viewport, true);
        if (!allowed) return;
        if (allowed.method === "resize") {
          viewport = allowed.params;
          await page.setViewportSize(viewport).catch(() => undefined);
          return;
        }
        await cdp.send(allowed.method, allowed.params as never).catch((error: unknown) => {
          console.info(liveLog("error", { accountId: input.accountId, detail: error instanceof Error ? error.message : "input" }));
        });
        return;
      }
      if (!typing && command.type === "mouse" && command.action !== "move") {
        const point = mapPointer(command.x, command.y, { width: command.canvasWidth, height: command.canvasHeight }, viewport);
        const href = await page.evaluate(({ x, y }) => {
          const node = document.elementFromPoint(x, y);
          const link = node?.closest?.("a[href]");
          return link?.getAttribute("href") ?? null;
        }, point).catch(() => null);
        const pointer = liveThreadClick(href) ? "thread" : "click";
        if (!liveControlAllowed(false, "control", "mouse", pointer)) return;
      }
      if (!typing && command.type === "mouse" && command.action === "move" && !liveControlAllowed(false, "control", "mouse", "scroll")) return;
      if (!typing && command.type === "wheel" && !liveControlAllowed(false, "control", "wheel", "scroll")) return;
      const next = deskCommand(command, viewport, typing);
      if (!next) return;
      if (next.method === "resize") {
        viewport = next.params;
        await page.setViewportSize(viewport).catch(() => undefined);
        return;
      }
      await cdp.send(next.method, next.params as never).catch((error: unknown) => {
        console.info(liveLog("error", { accountId: input.accountId, detail: error instanceof Error ? error.message : "input" }));
      });
    },
    acceptFile(file) {
      fileWait?.(file);
      fileWait = null;
    },
    async stop() {
      if (stopped) return;
      stopped = true;
      clearInterval(challengeTimer);
      console.info(liveLog("fin", { accountId: input.accountId }));
      await cdp?.send("Page.stopScreencast").catch(() => undefined);
      // La siguiente sala reutiliza esta página: no se apilan guardias ni escuchas de la anterior.
      page.off("framenavigated", onNavigated);
      page.off("framenavigated", onChallengeFrame);
      page.off("response", onResponse);
      await page.unroute("**/*", guardRoute).catch(() => undefined);
      await cdp?.detach().catch(() => undefined);
      cdp = null;
    },
  };
}

function liveFpsFromEnv(): number {
  const value = Number(process.env.FANLINK_LIVE_FPS);
  if (!Number.isInteger(value) || value < 1 || value > 8) return 4;
  return value;
}

function pathOf(raw: string): string {
  try {
    return new URL(raw).pathname.toLowerCase();
  } catch {
    return "";
  }
}
