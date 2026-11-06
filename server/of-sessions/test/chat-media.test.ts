import assert from "node:assert/strict";
import { test } from "node:test";
import { followMedia } from "../sync/history.ts";
import { canReadChatMedia } from "../sync/media-access.ts";

const row = { creatorId: "c-1", threadKey: "28022478" };

test("la miniatura exige el hilo de esa creadora y una sesión con mensajes", () => {
  assert.equal(canReadChatMedia({
    localOpen: false,
    role: null,
    perms: [],
    creatorId: "c-1",
    threadKey: "28022478",
    row,
  }), false);
  assert.equal(canReadChatMedia({
    localOpen: false,
    role: "member",
    perms: [],
    creatorId: "c-1",
    threadKey: "28022478",
    row,
  }), false);
  assert.equal(canReadChatMedia({
    localOpen: false,
    role: "member",
    perms: ["mensajes"],
    creatorId: "c-1",
    threadKey: "otro",
    row,
  }), false);
  assert.equal(canReadChatMedia({
    localOpen: false,
    role: "member",
    perms: ["mensajes"],
    creatorId: "c-1",
    threadKey: "28022478",
    row,
  }), true);
  assert.equal(canReadChatMedia({
    localOpen: true,
    role: "owner",
    perms: [],
    creatorId: "c-1",
    threadKey: "28022478",
    row,
  }), true);
  assert.equal(canReadChatMedia({
    localOpen: true,
    role: "owner",
    perms: [],
    creatorId: "c-2",
    threadKey: "28022478",
    row,
  }), false);
});

test("el fetch de la preview no sigue un redirect fuera de OnlyFans", async () => {
  const bytes = new Uint8Array([1, 2, 3]);
  const away = await followMedia("https://cdn2.onlyfans.com/a.jpg", async () => ({
    status: 302,
    location: "https://evil.example/x",
    body: null,
  }));
  assert.equal(away, null);
  const stay = await followMedia("https://cdn2.onlyfans.com/a.jpg", async (url) => {
    if (url.includes("cdn2")) return { status: 302, location: "https://cdn3.onlyfans.com/b.jpg", body: null };
    return { status: 200, location: null, body: bytes };
  });
  assert.deepEqual(stay, bytes);
});
