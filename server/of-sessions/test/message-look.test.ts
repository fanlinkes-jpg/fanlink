import assert from "node:assert/strict";
import { test } from "node:test";
import { parseChatMessages, releaseTags } from "../sync/chats.ts";
import { decodeMedia, encodeMedia } from "../sync/history.ts";

const page = {
  list: [
    {
      id: 900,
      text: "<p>Sesión nueva</p><p>Mira esto <b>ahora</b></p><br><p>Segundo párrafo</p>",
      createdAt: "2026-11-20T07:20:00+00:00",
      price: 19.99,
      isFree: false,
      canPurchase: true,
      fromUser: { id: 1 },
      releaseForms: [
        { id: 5, name: "Jason Carrera", partnerSource: "tag", type: "user", user: { id: 77, username: "jason" } },
        { id: 6, name: null, user: { username: "@pr_team" } },
        { id: 7, name: "Jason Carrera", user: { username: "jason" } },
        { id: 8 },
      ],
      media: [
        { id: 1, type: "photo", canView: false, files: { thumb: { url: "https://cdn2.onlyfans.com/t1.jpg" } } },
        { id: 2, type: "video", duration: 31, canView: false, files: { thumb: { url: "https://cdn2.onlyfans.com/t2.jpg" } } },
      ],
    },
    { id: 901, text: "<p>Hola</p>", createdAt: "2026-11-20T08:00:00+00:00", fromUser: { id: 7 }, media: [] },
  ],
  hasMore: false,
};

test("las etiquetas salen de releaseForms, sin repetir y sin vacías", () => {
  assert.deepEqual(releaseTags(page.list[0] as Record<string, unknown>), [
    { name: "Jason Carrera", username: "jason" },
    { name: null, username: "pr_team" },
  ]);
  assert.deepEqual(releaseTags({}), []);
  assert.deepEqual(releaseTags({ releaseForms: "x" }), []);
});

test("las etiquetas se guardan en cada medio y vuelven al leer; sin etiquetas no se añade la clave", () => {
  const [message, plain] = parseChatMessages(page, "7", "7", "1");
  assert.ok(message && plain);
  assert.equal(message.media?.length, 2);
  for (const item of message.media ?? []) assert.deepEqual(item.tags, [{ name: "Jason Carrera", username: "jason" }, { name: null, username: "pr_team" }]);
  const back = decodeMedia(encodeMedia(message.media));
  assert.equal(back?.[1]?.tags?.[1]?.username, "pr_team");
  assert.equal(plain.media?.length ?? 0, 0);
});

test("el texto conserva los párrafos de OnlyFans, una línea por párrafo", () => {
  const [message, plain] = parseChatMessages(page, "7", "7", "1");
  assert.equal(message?.body, "Sesión nueva\nMira esto ahora\nSegundo párrafo");
  assert.equal(plain?.body, "Hola");
});
