import type { BrowserContext, CDPSession, FileChooser, Frame, Page, Response, Route } from "playwright";
import { chatPageUrl } from "../sync/chats.ts";
import { parseChatMessages } from "../sync/chats.ts";
import { openWorkPage } from "../sessions/work-page.ts";
import { markLivePage } from "./pages.ts";
import { deskCommand, liveControlAllowed, liveHistoryGuardSource, liveLog, liveQuality, liveRequestAllowed, liveSocketGuardSource, liveThreadClick, liveTypingEnabled, mapPointer, type DeskInput } from "./desk.ts";
import { liveSectionPageUrl, type LiveSection } from "./sections.ts";
import { BROWSER_FINGERPRINT } from "../sessions/browser-factory.ts";
import { isLiveChallengeText, LIVE_CHALLENGE_NOTICE } from "./challenge.ts";
import { isTargetClosedMessage, LIVE_CLOSED_NOTICE } from "./closed.ts";
import { clearancePresent, liveChallengeUrl, liveRequestTrace, liveViewDebug } from "./debug.ts";

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
  onClosed?: (reason: string) => void;
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
  let reportedClosed = false;
  let challengeOpen = false;
  const reportClosed = () => {
    if (stopped || reportedClosed) return;
    reportedClosed = true;
    console.info(liveLog("error", { accountId: input.accountId, detail: "target-cerrado" }));
    input.onClosed?.(LIVE_CLOSED_NOTICE);
  };
  const noteSendError = (error: unknown) => {
    const message = error instanceof Error ? error.message : "input";
    if (isTargetClosedMessage(message)) {
      reportClosed();
      return;
    }
    console.info(liveLog("error", { accountId: input.accountId, detail: message }));
  };
  page.on("close", () => reportClosed());
  let fileWait: ((file: { name: string; mimeType: string; buffer: Buffer } | null) => void) | null = null;
  const debug = liveViewDebug();
  console.info(liveLog("inicio", { accountId: input.accountId, fps }));
  let guardsArmed = false;
  const armGuards = async () => {
    if (guardsArmed || stopped) return;
    guardsArmed = true;
    const history = liveHistoryGuardSource(chatUrl, section);
    const sockets = liveSocketGuardSource(typing);
    await page.addInitScript({ content: history });
    await page.addInitScript({ content: sockets });
    await page.evaluate((sources) => {
      for (const source of sources) Function(source)();
    }, [history, sockets]).catch(() => undefined);
  };
  const guardRoute = (route: Route) => {
    const url = route.request().url();
    const method = route.request().method();
    if (liveRequestAllowed(url, method, typing, section)) return route.continue();
    if (debug) {
      const trace = liveRequestTrace(method, url);
      if (trace) console.info(`[fanlink:live] abort ${trace}`);
    }
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
  const noteChallenge = (on: boolean) => {
    if (stopped || challengeOpen === on) return;
    challengeOpen = on;
    input.onNotice?.(on ? LIVE_CHALLENGE_NOTICE : "");
    if (!on) {
      void armGuards();
      if (debug) {
        void input.context.cookies("https://onlyfans.com").then((cookies) => {
          const names = cookies.map((cookie) => cookie.name);
          console.info(`[fanlink:live] cf_clearance=${clearancePresent(names) ? "si" : "no"} tras-reto`);
        }).catch(() => undefined);
      }
    }
  };
  let documentChecked: Promise<void> = Promise.resolve();
  const onResponse = (response: Response) => {
    const url = response.url();
    if (debug && liveChallengeUrl(url)) {
      const trace = liveRequestTrace(response.request().method(), url);
      if (trace) console.info(`[fanlink:live] reto status=${response.status()} ${trace}`);
    }
    const path = pathOf(url);
    const frame = response.request().frame();
    if (response.request().resourceType() === "document" && frame === page.mainFrame()) {
      documentChecked = response.text().then((text) => {
        const header = response.headers()["cf-mitigated"] === "challenge";
        noteChallenge(header || isLiveChallengeText(text.slice(0, 1500)));
      }).catch(() => undefined);
      return;
    }
    if (response.status() < 200 || response.status() >= 300) return;
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
  await page.goto(chatUrl, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => undefined);
  await documentChecked;
  if (!challengeOpen) await armGuards();
  cdp = await input.context.newCDPSession(page);
  if (debug) {
    const probe = await page.evaluate(() => {
      const nav = navigator as Navigator & { userAgentData?: { brands?: Array<{ brand: string }> } };
      return {
        webdriver: navigator.webdriver === true,
        ua: navigator.userAgent,
        brands: nav.userAgentData?.brands?.map((item) => item.brand).join(",") ?? "",
        lang: navigator.language,
        tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
        screen: `${screen.width}x${screen.height}`,
        outer: `${window.outerWidth}x${window.outerHeight}`,
        pos: `${window.screenX},${window.screenY}`,
      };
    }).catch(() => null);
    if (probe) {
      console.info(`[fanlink:live] sonda webdriver=${probe.webdriver ? "si" : "no"} lang=${probe.lang} tz=${probe.tz} screen=${probe.screen} outer=${probe.outer} pos=${probe.pos} brands=${probe.brands} ua=${probe.ua}`);
    }
    const names = (await input.context.cookies("https://onlyfans.com").catch(() => [])).map((cookie) => cookie.name);
    console.info(`[fanlink:live] cf_clearance=${clearancePresent(names) ? "si" : "no"}`);
  }
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
      if (stopped || reportedClosed || !cdp) return;
      if (challengeOpen) {
        const allowed = deskCommand(command, viewport, true);
        if (!allowed) return;
        if (allowed.method === "resize") {
          viewport = allowed.params;
          await page.setViewportSize(viewport).catch(() => undefined);
          return;
        }
        await cdp.send(allowed.method, allowed.params as never).catch((error: unknown) => {
          noteSendError(error);
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
        noteSendError(error);
      });
    },
    acceptFile(file) {
      fileWait?.(file);
      fileWait = null;
    },
    async stop() {
      if (stopped) return;
      stopped = true;
      console.info(liveLog("fin", { accountId: input.accountId }));
      await cdp?.send("Page.stopScreencast").catch(() => undefined);
      // La siguiente sala reutiliza esta página: no se apilan guardias ni escuchas de la anterior.
      page.off("framenavigated", onNavigated);
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
