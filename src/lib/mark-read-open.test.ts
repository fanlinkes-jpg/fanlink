import assert from "node:assert/strict";
import { test } from "node:test";
import { openedThread, shouldMarkOpened, type VisibleThread } from "./mark-read-open.ts";

const threads: VisibleThread[] = [
  { id: "a", unread: 2 },
  { id: "b", unread: 4 },
  { id: "c", unread: 0 },
];

test("teclado, la primera conversación y un aviso piden marcar leído; el flag apagado no", () => {
  const keyboard = openedThread({ how: "keyboard", threads, selectedId: "a", arrow: "down" });
  const auto = openedThread({ how: "auto", threads, selectedId: null });
  const notice = openedThread({ how: "notification", threads, selectedId: null, targetId: "b" });
  assert.equal(keyboard?.id, "b");
  assert.equal(auto?.id, "a");
  assert.equal(notice?.id, "b");
  for (const thread of [keyboard, auto, notice]) {
    assert.equal(shouldMarkOpened(thread, "true"), true);
    assert.equal(shouldMarkOpened(thread, undefined), false);
  }
  assert.equal(shouldMarkOpened(openedThread({ how: "keyboard", threads, selectedId: "b", arrow: "down" }), "true"), false);
  assert.equal(openedThread({ how: "hover", threads, selectedId: "a" }), null);
  assert.equal(openedThread({ how: "poll", threads, selectedId: "a" }), null);
});
