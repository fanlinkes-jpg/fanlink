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
