import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { followMedia } from "../sync/history.ts";
import { canReadChatMedia, chatMediaRouteStatus } from "../sync/media-access.ts";
import { pruneMediaCache } from "../sync/media-cache.ts";

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

test("la ruta /api/chat-media responde 404 sin permiso o con un hilo ajeno", () => {
  const reader = {
    localOpen: false,
    role: "member" as const,
    perms: [] as string[],
    creatorId: "c-1",
    threadKey: "28022478",
    row,
  };
  assert.equal(chatMediaRouteStatus({
    creatorId: "c-1",
    messageKey: "m1",
    threadKey: "28022478",
    indexRaw: "0",
    creatorAllowed: true,
    reader,
  }), 404);
  assert.equal(chatMediaRouteStatus({
    creatorId: "c-1",
    messageKey: "m1",
    threadKey: "otro",
    indexRaw: "0",
    creatorAllowed: true,
    reader: { ...reader, perms: ["mensajes"], threadKey: "otro" },
  }), 404);
  assert.equal(chatMediaRouteStatus({
    creatorId: "c-1",
    messageKey: "m1",
    threadKey: "28022478",
    indexRaw: "0",
    creatorAllowed: false,
    reader: { ...reader, perms: ["mensajes"] },
  }), 404);
  assert.equal(chatMediaRouteStatus({
    creatorId: "c-1",
    messageKey: "m1",
    threadKey: "28022478",
    indexRaw: "0",
    creatorAllowed: true,
    reader: { ...reader, perms: ["mensajes"] },
  }), 200);
  assert.equal(chatMediaRouteStatus({
    creatorId: "",
    messageKey: "m1",
    threadKey: "28022478",
    indexRaw: "0",
    creatorAllowed: true,
    reader: { ...reader, perms: ["mensajes"] },
  }), 404);
});

test("la caché de miniaturas borra lo viejo y no pasa del tope", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "fanlink-media-cache-"));
  try {
    const oldFile = path.join(dir, "old");
    const newFile = path.join(dir, "new");
    await writeFile(oldFile, "12345");
    const oldTime = new Date(Date.now() - 10_000);
    await utimes(oldFile, oldTime, oldTime);
    await writeFile(newFile, "ab");
    assert.equal(await pruneMediaCache(dir, Date.now(), { maxFiles: 1, maxBytes: 100, maxAgeMs: 60_000 }), 1);
    assert.deepEqual(await readdir(dir), ["new"]);
    const aged = new Date(Date.now() - 120_000);
    await utimes(newFile, aged, aged);
    assert.equal(await pruneMediaCache(dir, Date.now(), { maxAgeMs: 60_000 }), 1);
    assert.deepEqual(await readdir(dir), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
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
