import assert from "node:assert/strict";
import { test } from "node:test";
import { chromium } from "playwright";
import { parseChatMessages } from "../sync/chats.ts";
import { canProxyMedia, listPageDone, nextHistoryThread, nextMediaUrl, oldestCursor, pageFinished, paidLabel, purchaseLine } from "../sync/history.ts";
import { captureChatListPage, captureOlderMessages } from "../sync/history-scroll.ts";
import { startFixture } from "./fixture-site.ts";

test("el histórico, el medio y la compra salen del JSON y no se inventan", () => {
  const messages = parseChatMessages({
    list: [
      {
        id: 1,
        text: "Purchased — has purchased your message for $150.00",
        createdAt: "2026-11-01T10:00:00.000Z",
        fromUser: { id: 7 },
        price: 150,
        isOpened: true,
        isFavorite: true,
        isFromQueue: true,
        replyToMessage: { text: "el set" },
        media: [{ type: "video", duration: 12, canView: false, files: { thumb: { url: "https://cdn.example/a.jpg" } } }],
      },
      { id: 2, text: "propina", createdAt: "2026-11-02T10:00:00.000Z", fromUser: { id: 7 }, isTip: true, tipAmount: 20 },
    ],
  }, "7", "7", "42");
  const paid = messages.find((message) => message.messageKey === "1");
  assert.equal(paid?.media?.[0]?.kind, "video");
  assert.equal(paid?.media?.[0]?.seconds, 12);
  assert.equal(paid?.media?.[0]?.locked, true);
  assert.equal(paid?.media?.[0]?.preview, "https://cdn.example/a.jpg");
  assert.equal(paid?.liked, true);
  assert.equal(paid?.automatic, true);
  assert.equal(paid?.replyBody, "el set");
  assert.equal(paidLabel(15000, true), "$150.00 paid");
  assert.equal(paidLabel(15000, false), "not paid");
  assert.equal(paidLabel(null, true), null);
  assert.equal(purchaseLine(15000), "Purchased — has purchased your message for $150.00");
  assert.equal(messages.find((message) => message.messageKey === "2")?.eventKind, "propina");
  assert.equal(oldestCursor(messages), "1");
  assert.equal(pageFinished("1", [{ messageKey: "1", sentAt: "2026-11-01T10:00:00.000Z" }]), true);
  assert.equal(pageFinished("1", [{ messageKey: "0", sentAt: "2026-10-01T10:00:00.000Z" }]), false);
  assert.equal(nextHistoryThread([{ threadKey: "a", cursor: "1", done: true }, { threadKey: "b", cursor: null, done: false }])?.threadKey, "b");
  assert.equal(listPageDone(["7"], [{ threadKey: "7", fanKey: null, fanHandle: null, fanName: null, lastMessageAt: null, excerpt: null, unread: 0, lastFromUserId: null, lastFromFan: null, spentCents: null, subscribesCents: null, tipsCents: null, postsCents: null, messagesCents: null, avatarUrl: null, online: null, subPriceCents: null, subExpiresAt: null, renewAuto: null }]), true);
  assert.equal(canProxyMedia("https://cdn2.onlyfans.com/a.jpg"), true);
  assert.equal(canProxyMedia("https://cdn.example/a.jpg"), false);
  assert.equal(canProxyMedia("https://onlyfans.com/api2/v2/chats"), false);
  assert.equal(nextMediaUrl("https://cdn2.onlyfans.com/a.jpg", "https://evil.example/a.jpg"), null);
  assert.equal(nextMediaUrl("https://cdn2.onlyfans.com/a.jpg", "https://cdn3.onlyfans.com/b.jpg"), "https://cdn3.onlyfans.com/b.jpg");
});

test("el scroll del hilo y de la lista captura la página que pide el sitio", async () => {
  const fixture = await startFixture();
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    await context.addCookies([
      { name: "sess", value: "ok-1", url: fixture.origin },
      { name: "auth_id", value: "42", url: fixture.origin },
    ]);
    const thread = await context.newPage();
    await thread.goto(`${fixture.origin}/my/chats/chat/7`, { waitUntil: "domcontentloaded" });
    const older = await captureOlderMessages(thread, { threadKey: "7", fanKey: "7", accountUserId: "42", waitMs: 4_000 });
    assert.equal(older[0]?.messageKey, "1");
    assert.equal(older[0]?.body, "el primero");
    assert.equal(older[0]?.media?.[0]?.kind, "video");
    const list = await context.newPage();
    await list.goto(`${fixture.origin}/my/chats/full`, { waitUntil: "domcontentloaded" });
    const more = await captureChatListPage(list, "42", 4_000);
    assert.equal(more.some((item) => item.threadKey === "8"), true);
    await context.close();
  } finally {
    await browser.close();
    await fixture.close();
  }
});
