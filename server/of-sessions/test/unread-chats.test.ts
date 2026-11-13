import assert from "node:assert/strict";
import { test } from "node:test";
import { parseChatList } from "../sync/chats.ts";
import { markChatReadEnabled, noteMissingUnread, unreadAfterOpen, unreadChatRow, unreadChatTotal } from "../sync/unread-chats.ts";

const at = "2026-11-12T00:00:00.000Z";

function chat(id: string, unread?: number) {
  const row: Record<string, unknown> = {
    withUser: { id, name: `Fan ${id}` },
    lastMessage: { id: `p-${id}`, text: "previo", createdAt: at, fromUser: { id } },
  };
  if (unread != null) row.unreadMessagesCount = unread;
  return row;
}

test("dos de tres chats sin leer salen en negrita, con badge y total 2", () => {
  const threads = parseChatList({ list: [chat("1", 4), chat("2", 1), chat("3", 0)] }, "42");
  const rows = threads.map((thread) => unreadChatRow(thread.unread));
  assert.equal(unreadChatTotal(threads), 2);
  assert.equal(rows.filter((row) => row.bold).length, 2);
  assert.deepEqual(rows.map((row) => row.badge), [4, 1, null]);
  assert.equal(rows[2]?.bold, false);
  assert.equal(unreadAfterOpen(threads[0]?.unread ?? null), 4);
  assert.equal(markChatReadEnabled(undefined), false);
});

test("sin unreadMessagesCount no se inventa un 0 y el log lleva creator=", () => {
  const lines: string[] = [];
  const threads = parseChatList({ list: [chat("9")] }, "42");
  assert.equal(threads[0]?.unread, null);
  assert.deepEqual(unreadChatRow(threads[0]?.unread ?? null), { bold: false, badge: null });
  assert.equal(unreadChatTotal(threads), 0);
  noteMissingUnread("3zk7kbr", threads.filter((thread) => thread.unread == null).length, (line) => lines.push(line));
  assert.equal(lines[0], "[fanlink:chat] api lista creator=3zk7kbr sin unreadMessagesCount hilos=1");
  assert.equal(lines[0]?.includes("unread=0"), false);
});
