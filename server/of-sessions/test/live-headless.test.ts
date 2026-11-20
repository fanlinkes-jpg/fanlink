import assert from "node:assert/strict";
import { test } from "node:test";
import type { BrowserContext } from "playwright";
import { mkdtemp, readlink, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { isLiveChallengeText, isLiveLoginText, LIVE_CHALLENGE_NOTICE } from "../live/challenge.ts";
import { LOGIN_CLIENT_HINTS, loginUserAgentOverride } from "../live/fingerprint.ts";
import { isTargetClosedMessage, shouldReviveLive } from "../live/closed.ts";
import { clearStaleProfileLock, readProfileLock, waitForProfileLock } from "../sessions/profile-lock.ts";
import { clearancePresent, liveRequestTrace, liveViewDebug } from "../live/debug.ts";
import { liveLaunchForClearance, liveLaunchMode } from "../live/headless.ts";
import { LIVE_BASE_ARGS, LIVE_HEADLESS_ARGS, persistentContextLaunchOptions } from "../sessions/browser-factory.ts";
import { minimizeLiveWindow } from "../live/window.ts";
import { messages } from "../messages.ts";
import { ProfileOwner } from "../sessions/profile-owner.ts";
import { SessionPendingError } from "../types.ts";

test("en un Mac la vista queda fuera de pantalla y headless solo si se pide", () => {
  const mac = { platform: "darwin" as const };
  const win = { platform: "win32" as const };
  const linuxScreen = { platform: "linux" as const, display: ":0" };
  const linuxWayland = { platform: "linux" as const, wayland: "wayland-0" };
  const linuxHeadless = { platform: "linux" as const };
  assert.equal(liveLaunchMode({}, mac), "offscreen");
  assert.equal(liveLaunchMode({}, win), "offscreen");
  assert.equal(liveLaunchMode({}, linuxScreen), "offscreen");
  assert.equal(liveLaunchMode({}, linuxWayland), "offscreen");
  assert.equal(liveLaunchMode({}, linuxHeadless), "headless");
  assert.equal(liveLaunchMode({ FANLINK_LIVE_VIEW_HEADLESS: "true" }, mac), "headless");
  assert.equal(liveLaunchMode({ FANLINK_LIVE_VIEW_HEADLESS: "1" }, mac), "headless");
  assert.equal(liveLaunchMode({ FANLINK_LIVE_VIEW_HEADLESS: "false" }, mac), "window");
  assert.equal(liveLaunchMode({ FANLINK_LIVE_VIEW_HEADLESS: "0" }, linuxHeadless), "window");
  assert.equal(liveLaunchForClearance("offscreen", false), "window");
  assert.equal(liveLaunchForClearance("offscreen", true), "headless");
  assert.equal(liveLaunchForClearance("window", true), "window");
  assert.equal(liveLaunchForClearance("headless", false), "headless");
});

test("la vista usa la huella de Conectar y apaga webdriver en la ventana", () => {
  const offscreen = persistentContextLaunchOptions({ headless: false, live: "offscreen" });
  assert.equal(offscreen.headless, false);
  assert.deepEqual(offscreen.args, [...LIVE_BASE_ARGS]);
  assert.equal((offscreen.args ?? []).join(" ").includes("window-position"), false);
  assert.equal(offscreen.userAgent?.includes("Chrome/131.0.0.0"), true);
  assert.deepEqual(offscreen.viewport, { width: 1440, height: 900 });
  assert.equal(offscreen.ignoreDefaultArgs?.includes("--enable-automation"), true);
  assert.equal(offscreen.locale, "es-ES");
  assert.equal(offscreen.timezoneId, "Europe/Madrid");
  const headless = persistentContextLaunchOptions({ headless: false, live: "headless" });
  assert.deepEqual(headless.args, [...LIVE_HEADLESS_ARGS]);
  assert.equal(headless.userAgent?.includes("Chrome/131.0.0.0"), true);
  const work = persistentContextLaunchOptions({ headless: true });
  assert.equal(work.headless, true);
  assert.equal(work.userAgent?.includes("Chrome/131"), true);
  assert.equal(work.ignoreDefaultArgs, undefined);
  const windowed = persistentContextLaunchOptions({ headless: false, live: "window" });
  assert.equal(windowed.userAgent?.includes("Chrome/131.0.0.0"), true);
  assert.deepEqual(windowed.args, [...LIVE_BASE_ARGS]);
  assert.equal(windowed.ignoreDefaultArgs?.includes("--enable-automation"), true);
});

test("minimizar manda setWindowBounds y no toca la red", async () => {
  const calls: string[] = [];
  const ok = await minimizeLiveWindow(async (method, params) => {
    calls.push(method);
    if (method === "Browser.getWindowForTarget") return { windowId: 7 };
    assert.deepEqual(params, { windowId: 7, bounds: { windowState: "minimized" } });
    return {};
  });
  assert.equal(ok, true);
  assert.deepEqual(calls, ["Browser.getWindowForTarget", "Browser.setWindowBounds"]);
  assert.equal(await minimizeLiveWindow(async () => { throw new Error("cerrado"); }), false);
});

test("el diagnostico no escribe query, hash ni el valor de cf_clearance", () => {
  assert.equal(liveViewDebug({}), false);
  assert.equal(liveViewDebug({ FANLINK_LIVE_VIEW_DEBUG: "true" }), true);
  assert.equal(liveViewDebug({ FANLINK_LIVE_VIEW_DEBUG: "1" }), true);
  const traced = liveRequestTrace(
    "POST",
    "https://onlyfans.com/cdn-cgi/challenge-platform/h/g/flow/ov1/abcdefghijklmnopqrstuvwxyz012345?__cf_chl_tk=secreto&sign=abc#sess",
  );
  assert.equal(traced, "POST onlyfans.com/cdn-cgi/challenge-platform/h/g/flow/ov1/:id");
  assert.equal(traced?.includes("secreto"), false);
  assert.equal(traced?.includes("sign="), false);
  assert.equal(clearancePresent(["sess", "cf_clearance"]), true);
  assert.equal(clearancePresent(["sess"]), false);
});

test("un Chromium vivo bloquea el perfil y uno muerto se puede soltar", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "fanlink-lock-"));
  try {
    await symlink("mac.local-4242", path.join(dir, "SingletonLock"));
    assert.equal((await readProfileLock(dir))?.pid, 4242);
    assert.equal(await waitForProfileLock(dir, () => true, 0), "ajeno");
    assert.equal(await readlink(path.join(dir, "SingletonLock")), "mac.local-4242");
    assert.equal(await waitForProfileLock(dir, () => false, 0), "libre");
    await assert.rejects(() => readlink(path.join(dir, "SingletonLock")));
    await clearStaleProfileLock(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  assert.equal(isTargetClosedMessage("cdpSession.send: Target page, context or browser has been closed"), true);
  assert.equal(isTargetClosedMessage("timeout"), false);
  assert.equal(shouldReviveLive(0), true);
  assert.equal(shouldReviveLive(1), false);
});

test("la huella de la vista coincide con Chrome/131 y no con el binario", () => {
  const override = loginUserAgentOverride();
  assert.equal(override.userAgent.includes("Chrome/131.0.0.0"), true);
  assert.equal(override.userAgentMetadata.brands.some((item) => item.brand === "Google Chrome" && item.version === "131"), true);
  assert.equal(LOGIN_CLIENT_HINTS.fullVersion.startsWith("131."), true);
  assert.equal(isLiveLoginText("Iniciar sesión para continuar"), true);
  assert.equal(isLiveLoginText("Just a moment..."), false);
});

test("detecta el texto del reto antibots de OnlyFans", () => {
  assert.equal(isLiveChallengeText("Just a moment... We'll try your destination again in 15 seconds"), true);
  assert.equal(isLiveChallengeText("JUST A MOMENT… we'll try your destination again"), true);
  assert.equal(isLiveChallengeText("Checking if the site connection is secure"), true);
  assert.equal(isLiveChallengeText("Notifications\nAll activity"), false);
  assert.ok(LIVE_CHALLENGE_NOTICE.includes("comprobación antibots"));
  assert.ok(LIVE_CHALLENGE_NOTICE.includes("no se abre ninguna ventana"));
});

test("la vista nativa no reutiliza un Chromium headless ya abierto", async () => {
  const opened: string[] = [];
  const contexts = { shared: fakeContext(), visible: fakeContext() };
  const owner = new ProfileOwner({
    async openShared() {
      opened.push("shared");
      return contexts.shared;
    },
    async openExclusive() {
      opened.push("exclusive");
      return fakeContext();
    },
    async openVisible() {
      opened.push("visible");
      return contexts.visible;
    },
    async persist() {},
    async closeContext() {},
    isStopped() {
      return false;
    },
  });

  const work = await owner.lease("acc-1");
  assert.deepEqual(opened, ["shared"]);
  const visibleJob = owner.leaseVisible("acc-1");
  await Promise.resolve();
  await work.release();
  const live = await visibleJob;
  assert.deepEqual(opened, ["shared", "visible"]);
  assert.equal(live.context, contexts.visible);

  const again = await owner.leaseVisible("acc-1");
  assert.equal(again.context, contexts.visible);
  assert.deepEqual(opened, ["shared", "visible"]);
  await assert.rejects(() => owner.lease("acc-1"), (error: unknown) => {
    assert.ok(error instanceof SessionPendingError);
    assert.equal(error.message, messages.liveViewInProgress);
    return true;
  });
  await again.release();
  await live.release();
});

function fakeContext(): BrowserContext {
  return {} as BrowserContext;
}
