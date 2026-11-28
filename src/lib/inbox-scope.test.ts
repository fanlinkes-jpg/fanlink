import assert from "node:assert/strict";
import test from "node:test";
import { chatUnreadTotal, unreadBubbleText, creatorChipBadges, creatorWithPending, inboxCreators, inboxThreadList, INBOX_CREATOR_KEY, readInboxCreator, rememberInboxCreator, resolveInboxCreator, rowsForCreator, showsCreatorRail, unreadByCreator, visibleCreatorBadges, writeInboxCreator } from "./inbox-scope.ts";

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
  assert.deepEqual(unreadByCreator(threads), { jose: 4, allison: 2 });
  assert.equal(creatorWithPending(["jose", "baby", "allison"], threads), "jose");
  assert.equal(creatorWithPending(["baby", "allison"], threads), "allison");
});

test("los no leídos solo están en el badge de cada creadora visible", () => {
  const threads = [
    { creatorId: "jose", unread: 4 },
    { creatorId: "jose", unread: 1 },
    { creatorId: "allison", unread: 2 },
    { creatorId: "baby", unread: 0 },
    { creatorId: "9ikis52", unread: 9 },
    { creatorId: "h0jqunu", unread: 4 },
    { creatorId: "neztlav", unread: 7 },
  ];
  const badges = visibleCreatorBadges(threads, ["jose", "baby", "allison"]);
  assert.deepEqual(badges, { jose: 5, allison: 2 });
  assert.equal(Object.hasOwn(badges, "9ikis52"), false);
  assert.equal(Object.hasOwn(badges, "h0jqunu"), false);
  assert.equal(Object.hasOwn(badges, "neztlav"), false);
  assert.equal(unreadByCreator(threads)["9ikis52"], 9);
});

test("cada pestaña tiene su badge rojo y su badge verde", () => {
  const threads = [
    { creatorId: "jose", unread: 2 },
    { creatorId: "jose", unread: 1 },
    { creatorId: "allison", unread: 0 },
    { creatorId: "9ikis52", unread: 8 },
  ];
  const notices = [
    { creatorId: "jose", unread: 0 },
    { creatorId: "allison", unread: 128 },
    { creatorId: "h0jqunu", unread: 40 },
    { creatorId: "neztlav", unread: 7 },
  ];
  const badges = creatorChipBadges({ threads, notices, visibleIds: ["jose", "allison", "baby"] });
  assert.deepEqual(badges.jose, { messages: 3, notices: 0 });
  assert.deepEqual(badges.allison, { messages: 0, notices: 128 });
  assert.equal(badges.baby, undefined);
  assert.equal(Object.hasOwn(badges, "9ikis52"), false);
  assert.equal(Object.hasOwn(badges, "h0jqunu"), false);
  assert.equal(Object.hasOwn(badges, "neztlav"), false);
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

test("la misma creadora sigue en Operaciones, Mensajes y Mensajes inteligentes", () => {
  const sections = ["/notificaciones", "/mensajes", "/funciones"];
  for (const path of sections) assert.equal(showsCreatorRail(path), true);
  assert.equal(showsCreatorRail("/"), false);
  assert.equal(showsCreatorRail("/administrar"), false);
  const chosen = resolveInboxCreator({ requested: "allison", creators, remembered: "jose" });
  assert.equal(chosen, "allison");
  for (const path of sections) {
    assert.equal(showsCreatorRail(path), true);
    assert.equal(resolveInboxCreator({ requested: chosen, creators, remembered: "jose" }), "allison");
  }
  assert.equal(resolveInboxCreator({ requested: "all", creators, remembered: chosen }), "allison");
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

test("el badge de Mensajes de la creadora usa la cifra de OnlyFans si la hay", () => {
  const threads = [
    { creatorId: "3zk7kbr", unread: 3 },
    { creatorId: "3zk7kbr", unread: 4 },
    { creatorId: "otra", unread: 2 },
  ];
  const badges = creatorChipBadges({
    threads,
    notices: [{ creatorId: "3zk7kbr", unread: 10 }],
    visibleIds: ["3zk7kbr", "otra"],
    ofChats: [{ creatorId: "3zk7kbr", count: 6 }],
  });
  assert.deepEqual(badges["3zk7kbr"], { messages: 6, notices: 10 });
  assert.deepEqual(badges.otra, { messages: 2, notices: 0 });
  const sin = creatorChipBadges({ threads, notices: [], visibleIds: ["3zk7kbr"] });
  assert.deepEqual(sin["3zk7kbr"], { messages: 7, notices: 0 });
});

test("el total del icono de Mensajes suma los badges rojos de las creadoras visibles", () => {
  const threads = [
    { creatorId: "a", unread: 2 },
    { creatorId: "a", unread: 3 },
    { creatorId: "b", unread: 4 },
    { creatorId: "oculta", unread: 50 },
    { creatorId: "c", unread: null },
  ];
  assert.equal(chatUnreadTotal({ threads, visibleIds: ["a", "b", "c"] }), 9);
  assert.equal(chatUnreadTotal({ threads, visibleIds: ["a", "all"] }), 5);
  assert.equal(chatUnreadTotal({ threads, visibleIds: [] }), 0);
  // La cifra de OnlyFans manda sobre el recuento de hilos, igual que en el badge por creadora.
  assert.equal(chatUnreadTotal({ threads, visibleIds: ["a", "b"], ofChats: [{ creatorId: "a", count: 7 }] }), 11);
  const badges = creatorChipBadges({ threads, notices: [], visibleIds: ["a", "b"], ofChats: [{ creatorId: "a", count: 7 }] });
  assert.equal(chatUnreadTotal({ threads, visibleIds: ["a", "b"], ofChats: [{ creatorId: "a", count: 7 }] }), badges.a.messages + badges.b.messages);
});

test("la burbuja se oculta en 0 y pasa a 99+", () => {
  assert.equal(unreadBubbleText(0), "");
  assert.equal(unreadBubbleText(-3), "");
  assert.equal(unreadBubbleText(1), "1");
  assert.equal(unreadBubbleText(99), "99");
  assert.equal(unreadBubbleText(100), "99+");
  assert.equal(unreadBubbleText(1500), "99+");
});
