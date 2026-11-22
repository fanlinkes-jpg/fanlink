import assert from "node:assert/strict";
import test from "node:test";
import { creatorWithPending, inboxCreators, inboxThreadList, INBOX_CREATOR_KEY, readInboxCreator, rememberInboxCreator, resolveInboxCreator, rowsForCreator, unreadByCreator, visibleUnreadTotal, writeInboxCreator } from "./inbox-scope.ts";

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

test("el total de Mensajes es la suma de los badges visibles", () => {
  const threads = [
    { creatorId: "jose", unread: 4 },
    { creatorId: "jose", unread: 1 },
    { creatorId: "allison", unread: 2 },
    { creatorId: "baby", unread: 0 },
    { creatorId: "9ikis52", unread: 9 },
    { creatorId: "h0jqunu", unread: 4 },
    { creatorId: "neztlav", unread: 7 },
  ];
  const visible = ["jose", "baby", "allison"];
  const badges = unreadByCreator(threads);
  const total = visibleUnreadTotal(badges, visible);
  assert.equal(total, visible.reduce((sum, id) => sum + (badges[id] ?? 0), 0));
  assert.equal(total, 3);
  assert.equal(badges["9ikis52"], 1);
  assert.equal(badges.h0jqunu, 1);
  assert.equal(badges.neztlav, 1);
});

test("sin creadoras en el workspace la lista usa la primera cuenta y no mezcla", () => {
  const threads = [
    { creatorId: "cpreview", id: "fan-uno" },
    { creatorId: "otra", id: "ajeno" },
  ];
  const scope = inboxCreators([], [{ creatorId: "cpreview" }, { creatorId: "otra" }]);
  assert.deepEqual(scope.map((creator) => creator.id), ["cpreview", "otra"]);
  const list = inboxThreadList(threads, { requested: "all", creators: scope, remembered: null });
  assert.equal(list.creatorId, "cpreview");
  assert.deepEqual(list.threads.map((thread) => thread.id), ["fan-uno"]);
  assert.deepEqual(inboxCreators([{ id: "jose" }], [{ creatorId: "cpreview" }]).map((creator) => creator.id), ["jose"]);
});

test("la lista de chats solo contiene hilos de la creadora activa", () => {
  const threads = [
    { creatorId: "jose", id: "j1" },
    { creatorId: "allison", id: "a1" },
    { creatorId: "baby", id: "b1" },
    { creatorId: "allison", id: "a2" },
  ];
  const saved = inboxThreadList(threads, { requested: "all", creators, remembered: "allison" });
  assert.equal(saved.creatorId, "allison");
  assert.deepEqual(saved.threads.map((thread) => thread.id), ["a1", "a2"]);
  assert.equal(saved.threads.every((thread) => thread.creatorId === "allison"), true);
  const first = inboxThreadList(threads, { requested: "todas", creators, remembered: null });
  assert.equal(first.creatorId, "jose");
  assert.deepEqual(first.threads.map((thread) => thread.id), ["j1"]);
  const unknown = inboxThreadList(threads, { requested: "fantasma", creators, remembered: "no-existe" });
  assert.equal(unknown.threads.every((thread) => thread.creatorId === "jose"), true);
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
