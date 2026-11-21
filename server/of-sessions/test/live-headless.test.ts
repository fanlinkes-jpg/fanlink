import assert from "node:assert/strict";
import { test } from "node:test";
import type { BrowserContext } from "playwright";
import { mkdir, mkdtemp, readlink, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { isLiveChallengeText, isLiveLoginText, LIVE_CHALLENGE_NOTICE } from "../live/challenge.ts";
import { LOGIN_CLIENT_HINTS, loginUserAgentOverride } from "../live/fingerprint.ts";
import { isTargetClosedMessage, shouldReviveLive } from "../live/closed.ts";
import { clearStaleProfileLock, readProfileLock, waitForProfileLock } from "../sessions/profile-lock.ts";
import { profileHasClearanceName } from "../live/clearance-file.ts";
import { clearancePresent, liveRequestTrace, liveViewDebug, vaultWebTrace } from "../live/debug.ts";
import { liveLaunchMode, liveVisibility } from "../live/headless.ts";
import { profileSaveReason } from "../sessions/profile-owner.ts";
import { hideLiveProcess, liveContextOpen, liveHideScript, tuckLiveWindow } from "../live/window.ts";
import { LIVE_BASE_ARGS, LIVE_HEADLESS_ARGS, LIVE_IGNORED_DEFAULT_ARGS, LIVE_WINDOW_ARGS, persistentContextLaunchOptions } from "../sessions/browser-factory.ts";
import { chooseLiveChrome } from "../live/chrome.ts";
import { minimizeLiveWindow } from "../live/window.ts";
import { ProfileOwner } from "../sessions/profile-owner.ts";

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
  assert.equal(liveVisibility("offscreen").visibility, "minimized");
  assert.equal(liveVisibility("offscreen").reason, "arranque");
  assert.equal(liveVisibility("window").visibility, "window");
  assert.equal(liveVisibility("window").reason, "forzada");
  assert.equal(liveVisibility("headless").visibility, "headless");
});

test("la vista usa la huella de Conectar y apaga webdriver en la ventana", () => {
  const offscreen = persistentContextLaunchOptions({ headless: false, live: "offscreen" });
  assert.equal(offscreen.headless, false);
  assert.deepEqual(offscreen.args, [...LIVE_WINDOW_ARGS]);
  assert.equal((offscreen.args ?? []).join(" ").includes("--start-minimized"), true);
  assert.equal((offscreen.args ?? []).join(" ").includes("window-position"), false);
  assert.equal(offscreen.userAgent?.includes("Chrome/131.0.0.0"), true);
  assert.deepEqual(offscreen.viewport, { width: 1440, height: 900 });
  assert.equal(offscreen.ignoreDefaultArgs?.includes("--enable-automation"), true);
  assert.equal(offscreen.ignoreDefaultArgs?.includes("--disable-component-update"), true);
  assert.equal((offscreen.args ?? []).join(" ").includes("disable-component-update"), false);
  assert.deepEqual(offscreen.ignoreDefaultArgs, [...LIVE_IGNORED_DEFAULT_ARGS]);
  assert.equal(offscreen.channel, undefined);
  assert.equal(offscreen.locale, "es-ES");
  assert.equal(offscreen.timezoneId, "Europe/Madrid");
  const headless = persistentContextLaunchOptions({ headless: false, live: "headless" });
  assert.deepEqual(headless.args, [...LIVE_HEADLESS_ARGS]);
  assert.equal(headless.userAgent?.includes("Chrome/131.0.0.0"), true);
  const work = persistentContextLaunchOptions({ headless: true });
  assert.equal(work.headless, true);
  assert.equal(work.userAgent?.includes("Chrome/131"), true);
  assert.equal(work.ignoreDefaultArgs, undefined);
  const windowed = persistentContextLaunchOptions({ headless: false, live: "window", minimized: false });
  assert.equal(windowed.userAgent?.includes("Chrome/131.0.0.0"), true);
  assert.deepEqual(windowed.args, [...LIVE_BASE_ARGS]);
  assert.equal((windowed.args ?? []).join(" ").includes("--start-minimized"), false);
  assert.equal(windowed.ignoreDefaultArgs?.includes("--enable-automation"), true);
});

test("la vista prefiere Chrome estable y no toca una ruta que no existe", () => {
  const none = chooseLiveChrome({}, () => false);
  assert.equal(none.source, "testing");
  assert.equal(none.missingPath, false);
  const stable = chooseLiveChrome({}, (path) => path.endsWith("Google Chrome"));
  assert.equal(stable.source, "estable");
  assert.equal(stable.channel, "chrome");
  const routed = chooseLiveChrome({ FANLINK_LIVE_VIEW_CHROME_PATH: "/tmp/chrome" }, (path) => path === "/tmp/chrome");
  assert.equal(routed.source, "ruta");
  assert.equal(routed.executablePath, "/tmp/chrome");
  const missing = chooseLiveChrome({ FANLINK_LIVE_VIEW_CHROME_PATH: "/no/chrome" }, () => false);
  assert.equal(missing.source, "testing");
  assert.equal(missing.missingPath, true);
  const launched = persistentContextLaunchOptions({ headless: false, live: "window", channel: "chrome", executablePath: "/tmp/chrome" });
  assert.equal(launched.executablePath, "/tmp/chrome");
  assert.equal(launched.channel, undefined);
  assert.equal(launched.userAgent?.includes("Chrome/131.0.0.0"), true);
});

test("el ocultado recorre todos los Chromium y no solo el primero", () => {
  const script = liveHideScript();
  assert.match(script, /every process whose name is "Google Chrome for Testing"/);
  assert.match(script, /set visible of proc to false/);
  assert.equal(script.includes('process "Google Chrome for Testing"'), false);
});

test("si la ventana vuelve a maximizarse, se minimiza otra vez", async () => {
  const shown = await tuckLiveWindow(async (method, params) => {
    if (method === "Browser.getWindowForTarget") return { windowId: 3 };
    if (method === "Browser.getWindowBounds") return { bounds: { windowState: "maximized" } };
    assert.deepEqual(params, { windowId: 3, bounds: { windowState: "minimized" } });
    return {};
  });
  assert.equal(shown, "shown");
  const hidden = await tuckLiveWindow(async (method) => {
    if (method === "Browser.getWindowForTarget") return { windowId: 3 };
    if (method === "Browser.getWindowBounds") return { bounds: { windowState: "minimized" } };
    return {};
  });
  assert.equal(hidden, "hidden");
});

test("fuera de macOS no se llama a osascript", async () => {
  assert.equal(await hideLiveProcess("linux"), false);
  assert.equal(await hideLiveProcess("win32"), false);
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
  const web = vaultWebTrace(
    "GET",
    "https://onlyfans.com/api2/v2/vault/lists/28619188/media?limit=40&offset=0&list=28619188&field=recent&sort=desc&sign=abc&name=B%2FG%20LA%20DUCHA",
  );
  assert.equal(web, "GET /api2/v2/vault/lists/<n>/media?limit=<n>&offset=<n>&list=<n>&field=recent&sort=desc&name=<t>");
  assert.equal(web?.includes("28619188"), false);
  assert.equal(web?.includes("DUCHA"), false);
  assert.equal(web?.includes("sign"), false);
  const secret = vaultWebTrace("GET", "https://onlyfans.com/api2/v2/vault/media?list=all&session=abc&x-bc-extra=1&user-id=9&user_id=9&field=recent");
  assert.equal(secret, "GET /api2/v2/vault/media?list=all&field=recent");
  assert.equal(secret?.includes("user-id"), false);
  assert.equal(secret?.includes("user_id"), false);
  assert.equal(secret?.includes("session"), false);
  assert.equal(secret?.includes("x-bc"), false);
  assert.equal(vaultWebTrace("GET", "https://onlyfans.com/my/vault"), null);
  assert.equal(vaultWebTrace("GET", "https://onlyfans.com/api2/v2/vault/media?list=all&limit=40"), "GET /api2/v2/vault/media?list=all&limit=<n>");
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

test("el perfil guarda el nombre cf_clearance y no hace falta su valor", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "fanlink-cookie-"));
  try {
    const folder = path.join(dir, "Default", "Network");
    await mkdir(folder, { recursive: true });
    const sqlite = await import("node:sqlite").catch(() => null) as { DatabaseSync?: new (file: string) => { exec(sql: string): void; prepare(sql: string): { run(...args: string[]): void }; close(): void } } | null;
    if (!sqlite?.DatabaseSync) return;
    const db = new sqlite.DatabaseSync(path.join(folder, "Cookies"));
    db.exec("CREATE TABLE cookies (name TEXT, value TEXT)");
    db.prepare("INSERT INTO cookies (name, value) VALUES (?, ?)").run("cf_clearance", "no-se-lee");
    db.close();
    assert.equal(await profileHasClearanceName(dir), true);
    const other = await mkdtemp(path.join(tmpdir(), "fanlink-cookie-"));
    assert.equal(await profileHasClearanceName(other), false);
    await rm(other, { recursive: true, force: true });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
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
  const sharedRead = await owner.lease("acc-1");
  assert.equal(sharedRead.context, contexts.visible);
  assert.deepEqual(opened, ["shared", "visible"]);
  await sharedRead.release();
  await again.release();
  await live.release();
});

test("la vista cancela la lectura y abre el mismo perfil", async () => {
  const opened: string[] = [];
  let reader: { context: BrowserContext; release: () => Promise<void> } | null = null;
  const owner = new ProfileOwner({
    async openShared() {
      opened.push("shared");
      return fakeContext();
    },
    async openExclusive() {
      return fakeContext();
    },
    async openVisible() {
      opened.push("visible");
      return fakeContext();
    },
    async persist() {},
    async closeContext() {},
    async hurry() {
      await reader?.release();
    },
    isStopped() {
      return false;
    },
  });
  const held = await owner.lease("acc-cede");
  reader = held;
  const live = await owner.leaseVisible("acc-cede");
  assert.deepEqual(opened, ["shared", "visible"]);
  assert.notEqual(live.context, held.context);
  await live.release();
});

test("el fallo al guardar la sesión no escribe la url ni la cookie", () => {
  assert.equal(profileSaveReason(new Error("browserContext.storageState: Target page, context or browser has been closed")), "navegador-cerrado");
  assert.equal(profileSaveReason(new Error("Timeout 30000ms exceeded")), "tiempo");
  const messy = profileSaveReason(new Error("fallo https://onlyfans.com/api?sess=secreto /Users/ana/perfil cookie=abc"));
  assert.equal(messy.includes("secreto"), false);
  assert.equal(messy.includes("onlyfans.com"), false);
  assert.equal(messy.includes("cookie"), false);
});

test("la vista guarda el navegador y la siguiente entrada no lanza otro", async () => {
  const previous = process.env.FANLINK_LIVE_KEEP_MS;
  process.env.FANLINK_LIVE_KEEP_MS = "80";
  let opened = 0;
  let shared = 0;
  let closed = 0;
  const context = openableContext();
  const owner = new ProfileOwner({
    async openShared() {
      shared += 1;
      return openableContext();
    },
    async openExclusive() {
      return openableContext();
    },
    async openVisible() {
      opened += 1;
      return context;
    },
    async persist() {},
    async closeContext() {
      closed += 1;
    },
    isStopped() {
      return false;
    },
  });
  try {
    assert.equal(liveContextOpen(context), true);
    const first = await owner.leaseVisible("acc-guarda");
    await first.release();
    assert.equal(closed, 0, "soltar la vista no cierra el navegador");
    const second = await owner.leaseVisible("acc-guarda");
    assert.equal(opened, 1, "la segunda entrada lanzó otro Chromium");
    assert.equal(second.context, context);
    await second.release();
    const read = await owner.lease("acc-guarda");
    assert.equal(read.context, context, "la lectura abrió otro navegador");
    assert.equal(closed, 0);
    assert.equal(shared, 0);
    await read.release();
    context.kill();
    assert.equal(liveContextOpen(context), false);
    const third = await owner.leaseVisible("acc-guarda");
    assert.equal(opened, 2, "un navegador cerrado no se relanzó");
    await third.release();
    assert.ok(closed >= 2);
  } finally {
    if (previous == null) delete process.env.FANLINK_LIVE_KEEP_MS;
    else process.env.FANLINK_LIVE_KEEP_MS = previous;
    await owner.closeAll();
  }
});

function openableContext(): BrowserContext & { kill: () => void } {
  let dead = false;
  return {
    kill() {
      dead = true;
    },
    pages() {
      if (dead) throw new Error("closed");
      return [];
    },
    browser() {
      return { isConnected: () => !dead };
    },
  } as unknown as BrowserContext & { kill: () => void };
}

function fakeContext(): BrowserContext {
  return {} as BrowserContext;
}
