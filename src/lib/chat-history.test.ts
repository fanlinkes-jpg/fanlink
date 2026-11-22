import assert from "node:assert/strict";
import { test } from "node:test";
import { historyAdvance, olderChatMessagesPath, pageFinished } from "../../server/of-sessions/sync/history.ts";
import { mergeHistoryMessages, rememberThreadMessages, scrollAfterPrepend, scrollAnchor, scrollDeltaForAnchor } from "./chat-history.ts";

test("la página antigua usa el id del mensaje más viejo y hasMore cierra el hilo", () => {
  const path = olderChatMessagesPath("482191", "104");
  const url = new URL(path, "https://onlyfans.com");
  assert.equal(url.pathname, "/api2/v2/chats/482191/messages");
  assert.equal(url.searchParams.get("id"), "104");
  assert.equal(url.searchParams.get("order"), "desc");
  assert.equal(url.searchParams.get("limit"), "10");
  const more = historyAdvance({
    previousCursor: "104",
    incoming: [
      { messageKey: "90", sentAt: "2026-01-01T00:00:00.000Z" },
      { messageKey: "80", sentAt: "2025-12-01T00:00:00.000Z" },
    ],
    hasMore: true,
  });
  assert.equal(more.done, false);
  assert.equal(more.cursor, "80");
  const end = historyAdvance({
    previousCursor: "80",
    incoming: [{ messageKey: "70", sentAt: "2025-11-01T00:00:00.000Z" }],
    hasMore: false,
  });
  assert.equal(end.done, true);
  assert.equal(end.cursor, "70");
  assert.equal(pageFinished("80", [{ messageKey: "80", sentAt: "2025-12-01T00:00:00.000Z" }]), true);
});

test("el histórico no repite un mensaje y el scroll no salta", () => {
  const merged = mergeHistoryMessages(
    [
      { messageKey: "2", sentAt: "2026-02-01T00:00:00.000Z", body: "nuevo" },
      { messageKey: "3", sentAt: "2026-03-01T00:00:00.000Z", body: "último" },
    ],
    [
      { messageKey: "1", sentAt: "2026-01-01T00:00:00.000Z", body: "viejo" },
      { messageKey: "2", sentAt: "2026-02-01T00:00:00.000Z", body: "nuevo" },
    ],
  );
  assert.deepEqual(merged.map((message) => message.messageKey), ["1", "2", "3"]);
  const before = { scrollHeight: 800, scrollTop: 12 };
  assert.equal(scrollAfterPrepend(before, 1100), 312);
  assert.equal(scrollAfterPrepend(before, 800), 12);
  const anchor = scrollAnchor([
    { id: "a", top: 0, height: 40 },
    { id: "b", top: 100, height: 40 },
  ], 90);
  assert.deepEqual(anchor, { id: "b", offset: 10 });
  assert.equal(scrollDeltaForAnchor(anchor!, 400, 90), 300);
  assert.equal(scrollDeltaForAnchor(anchor!, 100, 90), 0);
  const seen = rememberThreadMessages(
    [{ messageKey: "1", sentAt: "2026-01-01T00:00:00.000Z" }],
    [{ messageKey: "9", sentAt: "2026-03-01T00:00:00.000Z" }],
  );
  assert.deepEqual(seen.messages.map((message) => message.messageKey), ["1", "9"]);
  assert.equal(seen.changed, true);
  const same = rememberThreadMessages(seen.messages, [seen.messages[0]!]);
  assert.equal(same.changed, false);
  assert.equal(same.messages.length, 2);
});
