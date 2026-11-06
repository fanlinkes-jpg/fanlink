import assert from "node:assert/strict";
import { test } from "node:test";
import { mediaHeaders, readPreviewBody } from "../sync/media-body.ts";
import { loadPreviewBytes } from "../sync/media-load.ts";
import { mediaForBrowser } from "../sync/media-client.ts";
import type { ChatMedia } from "../sync/chats.ts";

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

test("la miniatura de la bóveda dice el tipo real y nosniff", () => {
  const headers = mediaHeaders(new Uint8Array([0xff, 0xd8, 0xff]));
  assert.equal(headers["content-type"], "image/jpeg");
  assert.equal(headers["x-content-type-options"], "nosniff");
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

test("un goteo no alarga la miniatura más allá del reloj total", async () => {
  const stream = new ReadableStream({
    async pull(controller) {
      await new Promise((resolve) => setTimeout(resolve, 40));
      controller.enqueue(new Uint8Array([1]));
    },
  });
  const started = Date.now();
  assert.equal(await readPreviewBody(stream, 1_000, 1_000, 50), null);
  assert.ok(Date.now() - started < 400);
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
