import assert from "node:assert/strict";
import { test } from "node:test";
import { openUnreadFirst, threadsToOpen, type ChatThread } from "../sync/chats.ts";
import { LIVE_PUSH_MS, OPEN_INBOX_SYNC_MS, chatIntervalMinutes, inboxIsOpen, liveCursorChanged, noteInboxOpen } from "../sync/live.ts";

test("la bandeja abierta se entera en menos de 5 s y la lectura baja a 45 s", () => {
  assert.ok(LIVE_PUSH_MS <= 5_000);
  assert.equal(liveCursorChanged(null, "2026-11-06T10:00:00.000Z"), true);
  assert.equal(liveCursorChanged("2026-11-06T10:00:00.000Z", "2026-11-06T10:00:00.000Z"), false);
  assert.equal(chatIntervalMinutes(2, false), 2);
  assert.equal(chatIntervalMinutes(2, true), 2);
  assert.ok(OPEN_INBOX_SYNC_MS >= 15_000);
  assert.equal(inboxIsOpen(), false);
  const close = noteInboxOpen();
  assert.equal(inboxIsOpen(), true);
  close();
  assert.equal(inboxIsOpen(), false);
});

test("abrir no leídos se apaga con FANLINK_CHAT_OPEN_UNREAD=false", () => {
  const recent: ChatThread = thread("a", 0, "2026-11-06T12:00:00.000Z");
  const unread: ChatThread = thread("b", 2, "2026-11-06T08:00:00.000Z");
  assert.equal(openUnreadFirst(undefined), true);
  assert.equal(threadsToOpen([recent, unread], 1, true)[0]?.threadKey, "b");
  assert.equal(threadsToOpen([recent, unread], 1, false)[0]?.threadKey, "a");
  assert.equal(openUnreadFirst("false"), false);
});

function thread(id: string, unread: number, at: string): ChatThread {
  return {
    threadKey: id,
    fanKey: id,
    fanHandle: null,
    fanName: null,
    lastMessageAt: at,
    excerpt: null,
    unread,
    lastFromUserId: null,
    lastFromFan: null,
    spentCents: null,
    subscribesCents: null,
    tipsCents: null,
    postsCents: null,
    messagesCents: null,
    avatarUrl: null,
    online: null,
    subPriceCents: null,
    subExpiresAt: null,
    renewAuto: null,
  };
}
