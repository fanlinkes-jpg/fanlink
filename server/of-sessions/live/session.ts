import type { BrowserContext, CDPSession, FileChooser, Frame, Page, Response } from "playwright";
import { chatPageUrl } from "../sync/chats.ts";
import { parseChatMessages } from "../sync/chats.ts";
import { markLivePage } from "./pages.ts";
import { liveChromeOrigin, widevineProbe } from "./chrome.ts";
import { hideLiveProcess, liveProcessHideEnabled, tuckLiveWindow } from "./window.ts";
import { deskCommand, LIVE_BLOCKED_NOTICE, liveCastFps, liveCastQuality, liveCastStall, liveControlAllowed, liveFrameAllowed, liveFps, liveHistoryGuardSource, liveLog, liveOpenPageAllowed, livePageMetrics, liveQuality, liveSocketGuardSource, liveThreadClick, liveTypingEnabled, mapPointer, type DeskInput } from "./desk.ts";
import { lastLivePage, rememberLivePage, safeLivePage } from "./last-page.ts";
import { liveSectionPageUrl, type LiveSection } from "./sections.ts";
import { BROWSER_FINGERPRINT } from "../sessions/browser-factory.ts";
import { isLiveChallengeText, isLiveLoginText, LIVE_CHALLENGE_NOTICE, LIVE_LOGIN_NOTICE } from "./challenge.ts";
import { loginUserAgentOverride } from "./fingerprint.ts";
import { isTargetClosedMessage, LIVE_CLOSED_NOTICE } from "./closed.ts";
import { clearancePresent, liveChallengeUrl, liveRequestTrace, liveViewDebug, vaultCdnTrace, vaultWebTrace } from "./debug.ts";

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
  onLogin?: () => void;
}): Promise<LiveCast> {
  const fps = liveFps(process.env.FANLINK_LIVE_FPS);
  const quality = liveQuality(process.env.FANLINK_LIVE_QUALITY);
  const section: LiveSection = input.section ?? "chat";
  const needle = section === "notifications" ? "/my/notifications" : "/my/chats";
  const page = reusableLivePage(input.context, needle) ?? await input.context.newPage();
  for (const extra of input.context.pages()) {
    if (extra === page) continue;
    try {
      if (extra.url() === "about:blank") await extra.close().catch(() => undefined);
    } catch {
      // La pestaña ya no está.
    }
  }
  markLivePage(page);
  const typing = liveTypingEnabled();
  const homeUrl = section === "chat"
    ? chatPageUrl("https://onlyfans.com/my/chats", input.threadKey, "onlyfans")
    : (lastLivePage(input.accountId) ?? liveSectionPageUrl(section));
  let safeUrl = homeUrl;
  const fingerprint = BROWSER_FINGERPRINT.viewport;
  let viewport: { width: number; height: number } = { width: fingerprint.width, height: fingerprint.height };
  let cdp: CDPSession | null = null;
  let stopped = false;
  let reportedClosed = false;
  let stall: ReturnType<typeof setInterval> | null = null;
  let keepHidden: (motivo: string) => Promise<void> = async () => {};
  let challengeOpen = false;
  let loginOnPage = false;
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
    const history = liveHistoryGuardSource(safeUrl, section);
    const sockets = liveSocketGuardSource(typing);
    await page.addInitScript({ content: history });
    await page.addInitScript({ content: sockets });
    await page.evaluate((sources) => {
      for (const source of sources) Function(source)();
    }, [history, sockets]).catch(() => undefined);
  };
  page.on("popup", (popup) => {
    void popup.close().catch(() => undefined);
  });
  page.on("download", (download) => {
    void download.cancel().catch(() => undefined);
  });
  let goingHome = false;
  const onNavigated = (frame: Frame) => {
    if (frame !== page.mainFrame() || goingHome) return;
    const url = frame.url();
    if (!url || url === "about:blank" || url.startsWith("chrome-error:")) return;
    void keepHidden("navegacion");
    if (liveFrameAllowed(url, section)) {
      if (section === "notifications" && liveOpenPageAllowed(url)) {
        const safe = safeLivePage(url);
        if (safe) {
          safeUrl = safe;
          rememberLivePage(input.accountId, safe);
        }
      }
      return;
    }
    input.onNotice?.(LIVE_BLOCKED_NOTICE);
    goingHome = true;
    void page.goto(safeUrl, { waitUntil: "domcontentloaded" }).catch(() => undefined).finally(() => {
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
    void keepHidden(on ? "reto" : "reto-listo");
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
        const sample = text.slice(0, 2000);
        const header = response.headers()["cf-mitigated"] === "challenge";
        if (isLiveLoginText(sample)) loginOnPage = true;
        noteChallenge(header || isLiveChallengeText(sample));
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
  const hints = await input.context.newCDPSession(page);
  await hints.send("Emulation.setUserAgentOverride", loginUserAgentOverride() as never).catch(() => undefined);
  let hiddenLogged = false;
  let windowWatch: ReturnType<typeof setInterval> | null = null;
  let tuckChain: Promise<void> = Promise.resolve();
  const sendWindow = (method: string, params?: Record<string, unknown>) => hints.send(method as "Browser.getWindowForTarget", params as never);
  const tuckAll = async (): Promise<"hidden" | "shown" | "fail"> => {
    let pages;
    try {
      pages = input.context.pages();
    } catch {
      return "fail";
    }
    let any = false;
    let shown = false;
    for (const item of pages) {
      if (item === page) {
        const state = await tuckLiveWindow(sendWindow);
        if (state === "fail") continue;
        any = true;
        if (state === "shown") shown = true;
        continue;
      }
      const cdp = await input.context.newCDPSession(item);
      try {
        const state = await tuckLiveWindow((method, params) => cdp.send(method as "Browser.getWindowForTarget", params as never));
        if (state === "fail") continue;
        any = true;
        if (state === "shown") shown = true;
      } finally {
        await cdp.detach().catch(() => undefined);
      }
    }
    if (!any) return "fail";
    return shown ? "shown" : "hidden";
  };
  keepHidden = (motivo: string) => {
    const run = tuckChain.then(() => applyHidden(motivo));
    tuckChain = run.catch(() => undefined);
    return run;
  };
  const applyHidden = async (motivo: string) => {
    if (stopped) return;
    const state = await tuckAll();
    const shown = state === "shown";
    if (!shown && hiddenLogged && motivo === "vigia") return;
    const dock = liveProcessHideEnabled() ? await hideLiveProcess() : false;
    if (state !== "fail") hiddenLogged = true;
    const oculto = liveProcessHideEnabled() ? (dock ? "osascript" : "no") : "cdp";
    console.info(`[fanlink:navegador] vista=live ${shown ? "reoculto" : "minimizo"} perfil=${input.accountId} motivo=${motivo} ok=${state === "fail" ? "no" : "si"} oculto=${oculto}`);
  };
  windowWatch = setInterval(() => {
    void keepHidden("vigia");
  }, 1_000);
  windowWatch.unref?.();
  await keepHidden("antes");
  const here = page.url();
  const already = here.includes("onlyfans.com") && liveFrameAllowed(here, section);
  if (!already) await page.goto(safeUrl, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => undefined);
  await documentChecked;
  const drm = await page.evaluate(widevineProbe).catch(() => false);
  const binary = input.context.browser()?.version() ?? "desconocida";
  console.info(`[fanlink:navegador] vista=live binario=${binary} origen=${liveChromeOrigin()} drm=${drm ? "si" : "no"}`);
  const passwordVisible = await page.locator('input[type="password"]:visible').count().then((count) => count > 0).catch(() => false);
  if (!challengeOpen && (loginOnPage || passwordVisible)) {
    console.info(liveLog("error", { accountId: input.accountId, detail: "login-visible" }));
    input.onNotice?.(LIVE_LOGIN_NOTICE);
    input.onLogin?.();
    return {
      async send() {},
      acceptFile() {},
      async stop() {
        stopped = true;
        if (windowWatch) clearInterval(windowWatch);
        if (stall) clearInterval(stall);
        await hints.detach().catch(() => undefined);
      },
    };
  }
  if (!challengeOpen) await armGuards();
  await keepHidden("carga");
  cdp = await input.context.newCDPSession(page);
  if (debug) {
    cdp.on("Network.requestWillBeSent", (event: { request?: { method?: string; url?: string; headers?: Record<string, string> } }) => {
      const method = event.request?.method;
      const target = event.request?.url;
      if (!method || !target) return;
      const line = vaultWebTrace(method, target);
      if (line) console.info(`[fanlink:vault-web] ${line}`);
      const headers = event.request?.headers;
      const cookie = headers?.Cookie ?? headers?.cookie ?? null;
      const cdn = vaultCdnTrace(method, target, cookie);
      if (cdn) console.info(`[fanlink:vault-web] ${cdn}`);
    });
    await cdp.send("Network.enable").catch(() => {
      console.info("[fanlink:vault-web] red=no");
    });
  }
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
      const binary = input.context.browser()?.version() ?? "desconocida";
      console.info(`[fanlink:live] sonda webdriver=${probe.webdriver ? "si" : "no"} lang=${probe.lang} tz=${probe.tz} screen=${probe.screen} outer=${probe.outer} pos=${probe.pos} brands=${probe.brands} binario=${binary} ua=${probe.ua}`);
    }
    const names = (await input.context.cookies("https://onlyfans.com").catch(() => [])).map((cookie) => cookie.name);
    console.info(`[fanlink:live] cf_clearance=${clearancePresent(names) ? "si" : "no"}`);
  }
  let lastFrame = 0;
  let sawFrame = false;
  let hotUntil = 0;
  let castHot = false;
  let lastImageAt = Date.now();
  let castRestarts = 0;
  const applyMetrics = async (metrics: ReturnType<typeof livePageMetrics>) => {
    if (!cdp || stopped) return;
    viewport = { width: metrics.width, height: metrics.height };
    await cdp.send("Emulation.setDeviceMetricsOverride", metrics).catch(() => undefined);
    console.info(`[fanlink:navegador] vista=live viewport=${metrics.width}x${metrics.height} screen=${metrics.screenWidth}x${metrics.screenHeight} perfil=${input.accountId}`);
    await restartCast(castHot);
    lastImageAt = Date.now();
  };
  const paintFrame = (jpeg: Buffer, width: number, height: number) => {
    input.onFrame({ jpeg, width, height });
  };
  const restartCast = async (hot: boolean) => {
    if (!cdp || stopped) return;
    castHot = hot;
    await cdp.send("Page.stopScreencast").catch(() => undefined);
    await cdp.send("Page.startScreencast", {
      format: "jpeg",
      quality: liveCastQuality(quality, hot),
      everyNthFrame: 1,
    }).catch(() => undefined);
  };
  cdp.on("Page.screencastFrame", (event: { data: string; sessionId: number; metadata?: { deviceWidth?: number; deviceHeight?: number } }) => {
    void cdp?.send("Page.screencastFrameAck", { sessionId: event.sessionId }).catch(() => undefined);
    const now = Date.now();
    lastImageAt = now;
    castRestarts = 0;
    const hot = now < hotUntil;
    if (hot !== castHot) void restartCast(hot);
    const gap = Math.round(1000 / liveCastFps(fps, hot));
    if (now - lastFrame < gap) return;
    lastFrame = now;
    if (event.metadata?.deviceWidth && event.metadata.deviceHeight) {
      viewport = { width: event.metadata.deviceWidth, height: event.metadata.deviceHeight };
    }
    paintFrame(Buffer.from(event.data, "base64"), viewport.width, viewport.height);
    if (!sawFrame) {
      sawFrame = true;
      console.info(liveLog("inicio", { accountId: input.accountId, detail: "imagen" }));
    }
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: liveCastQuality(quality, false), everyNthFrame: 1 });
  stall = setInterval(() => {
    if (stopped || !cdp) return;
    const action = liveCastStall(Date.now() - lastImageAt, castRestarts);
    if (action === "espera") return;
    if (action === "reinicio") {
      castRestarts += 1;
      lastImageAt = Date.now();
      console.info(`[fanlink:navegador] vista=live screencast=reinicio perfil=${input.accountId}`);
      void restartCast(castHot);
      return;
    }
    console.info(`[fanlink:navegador] vista=live screencast=relanzo perfil=${input.accountId}`);
    if (stall) clearInterval(stall);
    input.onClosed?.(LIVE_CLOSED_NOTICE);
  }, 2_000);
  stall.unref?.();

  return {
    async send(command) {
      if (stopped || reportedClosed || !cdp) return;
      hotUntil = Date.now() + 2_000;
      const browsing = section === "notifications";
      if (challengeOpen || browsing) {
        const allowed = deskCommand(command, viewport, true);
        if (!allowed) return;
        if (allowed.method === "resize") {
          await applyMetrics(allowed.params);
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
        await applyMetrics(next.params);
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
      await hints.detach().catch(() => undefined);
      // La siguiente sala reutiliza esta página: no se apilan guardias ni escuchas de la anterior.
      page.off("framenavigated", onNavigated);
      page.off("response", onResponse);
      if (windowWatch) clearInterval(windowWatch);
      if (stall) clearInterval(stall);
      await cdp?.detach().catch(() => undefined);
      cdp = null;
    },
  };
}

/** La página que ya está abierta. No crea otra ventana. */
function reusableLivePage(context: BrowserContext, needle: string): Page | null {
  const pages = context.pages();
  const match = pages.find((page) => {
    try {
      return page.url().includes(needle);
    } catch {
      return false;
    }
  });
  if (match) return match;
  const site = pages.find((page) => {
    try {
      return page.url().includes("onlyfans.com");
    } catch {
      return false;
    }
  });
  if (site) return site;
  const blank = pages.find((page) => {
    try {
      return page.url() === "about:blank";
    } catch {
      return false;
    }
  });
  return blank ?? pages[0] ?? null;
}

function pathOf(raw: string): string {
  try {
    return new URL(raw).pathname.toLowerCase();
  } catch {
    return "";
  }
}
