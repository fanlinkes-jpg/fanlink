import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { loadPreviewBytes } from "../sync/media-load.ts";
import { canReadChatMedia, chatMediaRouteStatus } from "../sync/media-access.ts";
import { pruneMediaCache, resetMediaPruneClock, shouldPruneMediaCache } from "../sync/media-cache.ts";
import { mediaForBrowser } from "../sync/media-play.ts";
import { followMedia, readCappedBytes } from "../sync/media-url.ts";
import type { ChatMedia } from "../sync/chats.ts";

const row = { creatorId: "c-1", threadKey: "28022478" };

const hidden: ChatMedia = {
  kind: "video",
  seconds: 12,
  preview: "https://cdn2.onlyfans.com/t.jpg",
  full: "https://cdn2.onlyfans.com/secreto.mp4",
  locked: true,
  priceCents: 1500,
  paid: false,
  opened: false,
};

test("la miniatura exige el hilo de esa creadora", () => {
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
    role: "member",
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
    reader: { ...reader, localOpen: true },
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

test("el navegador no recibe la URL completa de un medio bloqueado del fan", () => {
  const fan = mediaForBrowser([hidden], true);
  assert.equal(fan?.[0]?.full, null);
  assert.equal(fan?.[0]?.preview, hidden.preview);
  const own = mediaForBrowser([hidden], false);
  assert.equal(own?.[0]?.full, hidden.full);
  const open = mediaForBrowser([{ ...hidden, locked: false, paid: true }], true);
  assert.equal(open?.[0]?.full, hidden.full);
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

test("la miniatura se corta al pasar el tope y followMedia no espera sin límite", async () => {
  let cancelled = false;
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3, 4, 5]));
    },
    cancel() {
      cancelled = true;
    },
  });
  assert.equal(await readCappedBytes(stream, 3, 1_000, 1_000), null);
  assert.equal(cancelled, true);
  const timed = await followMedia("https://cdn2.onlyfans.com/a.jpg", () => new Promise(() => undefined), 30);
  assert.equal(timed, null);
});

test("un goteo no alarga la miniatura más allá del reloj total", async () => {
  const stream = new ReadableStream({
    async pull(controller) {
      await new Promise((resolve) => setTimeout(resolve, 40));
      controller.enqueue(new Uint8Array([1]));
    },
  });
  const started = Date.now();
  assert.equal(await readCappedBytes(stream, 1_000, 1_000, 50), null);
  assert.ok(Date.now() - started < 400);
});

test("la poda de miniaturas no se repite en cada escritura", () => {
  resetMediaPruneClock();
  const dir = "cache-prueba";
  assert.equal(shouldPruneMediaCache(dir, 1_000, 60_000), true);
  assert.equal(shouldPruneMediaCache(dir, 2_000, 60_000), false);
  assert.equal(shouldPruneMediaCache(dir, 70_000, 60_000), true);
  resetMediaPruneClock();
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

test("con sesión la miniatura no sale por el fetch del servidor", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (() => {
    calls += 1;
    return Promise.resolve(new Response(new Uint8Array([9])));
  }) as typeof fetch;
  try {
    const bytes = await loadPreviewBytes("https://cdn2.onlyfans.com/a.jpg", async (task) => task({
      async get() {
        return {
          status: () => 200,
          headers: () => ({ "content-length": "1" }),
          body: async () => new Uint8Array([7]),
        };
      },
    }));
    assert.deepEqual(bytes, new Uint8Array([7]));
    const missed = await loadPreviewBytes("https://cdn2.onlyfans.com/a.jpg", async () => null);
    assert.equal(missed, null);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = original;
  }
});
