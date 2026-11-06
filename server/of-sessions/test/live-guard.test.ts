import assert from "node:assert/strict";
import { test } from "node:test";
import { chromium } from "playwright";
import { liveHistoryGuardSource, liveRequestAllowed } from "../live/desk.ts";

test("la página en directo no abre statements, ajustes, un popup ni una descarga", async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const downloads: string[] = [];
  page.on("download", (download) => {
    downloads.push(download.url());
    void download.cancel();
  });
  try {
    await page.addInitScript({ content: liveHistoryGuardSource() });
    await page.route("**/*", (route) => {
      if (!liveRequestAllowed(route.request().url())) return route.abort();
      return route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<!doctype html><title>chat</title>",
      });
    });
    const chat = await page.goto("https://onlyfans.com/my/chats/chat/7", { waitUntil: "domcontentloaded" });
    assert.equal(chat?.ok(), true);
    const stayed = await page.evaluate(() => {
      history.pushState({}, "", "/my/statements");
      const statements = location.pathname;
      history.pushState({}, "", "/my/settings");
      const settings = location.pathname;
      history.pushState({}, "", "/my/chats/chat/9");
      const allowed = location.pathname;
      const popup = window.open("https://onlyfans.com/my/payouts");
      return { statements, settings, allowed, popup: popup == null };
    });
    assert.equal(stayed.statements, "/my/chats/chat/7");
    assert.equal(stayed.settings, "/my/chats/chat/7");
    assert.equal(stayed.allowed, "/my/chats/chat/9");
    assert.equal(stayed.popup, true);
    for (const path of ["/my/statements", "/my/statistics", "/my/banking", "/my/payouts", "/my/settings"]) {
      const blocked = await page.goto(`https://onlyfans.com${path}`, { waitUntil: "commit" }).catch((error: unknown) => error);
      assert.equal(blocked instanceof Error, true, path);
    }
    assert.deepEqual(downloads, []);
  } finally {
    await browser.close();
  }
});

test("el filtro de la pestaña no corta el POST de otra página de la cuenta", async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const live = await context.newPage();
  const sync = await context.newPage();
  try {
    await live.route("**/*", (route) => {
      if (!liveRequestAllowed(route.request().url(), route.request().method(), false)) return route.abort();
      return route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><html><body>live</body></html>" });
    });
    await sync.route("**/*", (route) => route.fulfill({ status: 200, body: "sync" }));
    const blocked = await live.evaluate(async () => {
      try {
        const response = await fetch("https://onlyfans.com/api2/v2/chats/7/messages", { method: "POST" });
        return response.status;
      } catch {
        return 0;
      }
    });
    const sent = await sync.evaluate(async () => {
      const response = await fetch("https://onlyfans.com/api2/v2/chats/7/messages", { method: "POST" });
      return response.status;
    });
    assert.equal(blocked, 0);
    assert.equal(sent, 200);
    await live.addInitScript({ content: liveHistoryGuardSource("https://onlyfans.com/my/chats/chat/9") });
    await live.goto("https://onlyfans.com/my/chats/chat/7", { waitUntil: "domcontentloaded" });
    await live.evaluate(() => {
      document.body.innerHTML = "<h1>Statements</h1>";
    });
    await live.waitForURL("**/my/chats/chat/9", { waitUntil: "commit", timeout: 5_000 });
    const workerBlocked = await live.evaluate(async () => {
      try {
        await navigator.serviceWorker.register("/sw.js");
        return false;
      } catch {
        return true;
      }
    });
    assert.equal(workerBlocked, true);
  } finally {
    await browser.close();
  }
});
