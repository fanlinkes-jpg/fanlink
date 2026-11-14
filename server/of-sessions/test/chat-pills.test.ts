import assert from "node:assert/strict";
import { test } from "node:test";
import { inboxPillCounts, matchesInboxPill, tipThreads, type PillMessage, type PillThread } from "../sync/chat-pills.ts";

const threads: PillThread[] = [
  { threadKey: "1", unread: 4 },
  { threadKey: "2", unread: null },
  { threadKey: "3", unread: 0 },
];
const messages: PillMessage[] = [
  { threadKey: "1", eventKind: "propina" },
  { threadKey: "2", eventKind: null },
  { threadKey: "3", eventKind: "compra" },
];

test("las pastillas cuentan con datos, sin datos y con null mezclado", () => {
  assert.deepEqual(inboxPillCounts({ status: "loading", threads, messages }), { todos: null, sinLeer: null, propinas: null });
  assert.deepEqual(inboxPillCounts({ status: "error", threads, messages }), { todos: null, sinLeer: null, propinas: null });
  assert.deepEqual(inboxPillCounts({ status: "ready", threads, messages: null }), { todos: 3, sinLeer: 1, propinas: null });
  assert.deepEqual(inboxPillCounts({ status: "ready", threads, messages }), { todos: 3, sinLeer: 1, propinas: 1 });
  const withSpend = [...threads, { threadKey: "4", unread: 0, tipsCents: 250 }, { threadKey: "5", unread: 0, tipsCents: 0 }];
  assert.equal(inboxPillCounts({ status: "ready", threads: withSpend, messages: null }).propinas, 1);
  assert.equal(inboxPillCounts({ status: "ready", threads: withSpend, messages }).propinas, 2);
  const unknown = threads.map((thread) => ({ ...thread, unread: null }));
  assert.equal(inboxPillCounts({ status: "ready", threads: unknown, messages }).sinLeer, null);
  assert.equal(inboxPillCounts({ status: "ready", threads: [], messages: [] }).todos, 0);
});

test("cada pastilla filtra la lista", () => {
  const withSpend = [...threads, { threadKey: "4", unread: 0, tipsCents: 250 }];
  const tipped = tipThreads(messages, withSpend);
  assert.deepEqual(withSpend.filter((thread) => matchesInboxPill(thread, "todos", tipped)).map((thread) => thread.threadKey), ["1", "2", "3", "4"]);
  assert.deepEqual(withSpend.filter((thread) => matchesInboxPill(thread, "sin-leer", tipped)).map((thread) => thread.threadKey), ["1"]);
  assert.deepEqual(withSpend.filter((thread) => matchesInboxPill(thread, "propinas", tipped)).map((thread) => thread.threadKey), ["1", "4"]);
});
