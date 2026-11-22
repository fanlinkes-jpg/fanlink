import assert from "node:assert/strict";
import test from "node:test";
import { creatorWithPending, INBOX_CREATOR_KEY, readInboxCreator, rememberInboxCreator, resolveInboxCreator, rowsForCreator, unreadByCreator, writeInboxCreator } from "./inbox-scope.ts";

const creators = [{ id: "jose" }, { id: "baby" }, { id: "allison" }];

test("Todas guardada o en la URL elige la última creadora, o la primera", () => {
  assert.equal(resolveInboxCreator({ requested: "all", creators, remembered: "allison" }), "allison");
  assert.equal(resolveInboxCreator({ requested: "todas", creators, remembered: null }), "jose");
  assert.equal(resolveInboxCreator({ requested: "all", creators, remembered: "all" }), "jose");
  assert.equal(resolveInboxCreator({ requested: "baby", creators, remembered: "allison" }), "baby");
  assert.equal(resolveInboxCreator({ requested: "fantasma", creators, remembered: null }), "jose");
  assert.equal(rememberInboxCreator("all"), null);
  assert.equal(rememberInboxCreator("allison"), "allison");
  const box = new Map<string, string>();
  const storage = {
    getItem: (key: string) => box.get(key) ?? null,
    setItem: (key: string, value: string) => {
      box.set(key, value);
    },
  };
  writeInboxCreator(storage, "all");
  assert.equal(readInboxCreator(storage), null);
  writeInboxCreator(storage, "allison");
  assert.equal(box.get(INBOX_CREATOR_KEY), "allison");
  assert.equal(resolveInboxCreator({ requested: "all", creators, remembered: readInboxCreator(storage) }), "allison");
});

test("cada creadora tiene su badge y el total no mezcla la vista", () => {
  const threads = [
    { creatorId: "jose", unread: 4 },
    { creatorId: "jose", unread: 0 },
    { creatorId: "allison", unread: 2 },
    { creatorId: "baby", unread: null },
  ];
  assert.deepEqual(unreadByCreator(threads), { jose: 1, allison: 1 });
  assert.equal(creatorWithPending(["jose", "baby", "allison"], threads), "jose");
  assert.equal(creatorWithPending(["baby", "allison"], threads), "allison");
});

test("una creadora no ve chats, fans, avisos ni bóveda de otra", () => {
  const chats = [{ creatorId: "jose", id: "hilo-jose" }, { creatorId: "allison", id: "hilo-allison" }];
  const fans = [{ creatorId: "jose", id: "fan-jose" }, { creatorId: "allison", id: "fan-allison" }];
  const notes = [{ creatorId: "jose", id: "aviso-jose" }, { creatorId: "allison", id: "aviso-allison" }];
  const vault = [{ creatorId: "jose", id: "medio-jose" }, { creatorId: "allison", id: "medio-allison" }];
  assert.deepEqual(rowsForCreator(chats, "allison").map((row) => row.id), ["hilo-allison"]);
  assert.deepEqual(rowsForCreator(fans, "allison").map((row) => row.id), ["fan-allison"]);
  assert.deepEqual(rowsForCreator(notes, "allison").map((row) => row.id), ["aviso-allison"]);
  assert.deepEqual(rowsForCreator(vault, "allison").map((row) => row.id), ["medio-allison"]);
  assert.deepEqual(rowsForCreator(chats, "all"), []);
  assert.deepEqual(rowsForCreator(chats, null), []);
});
