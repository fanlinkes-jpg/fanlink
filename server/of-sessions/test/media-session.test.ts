import assert from "node:assert/strict";
import { test } from "node:test";
import { BROWSER_FINGERPRINT } from "../sessions/browser-factory.ts";
import { readSessionMedia, sessionHeaders, sessionUpstream } from "../sync/media-session.ts";
import type { SessionRequest } from "../sync/media-session.ts";

test("la sesión no manda cookies copiadas y no lee un cuerpo por encima de 5 MB", async () => {
  const seen: Array<Record<string, string>> = [];
  let bodies = 0;
  const bytes = await readSessionMedia(client(async (_url, init) => {
    seen.push(init.headers ?? {});
    return {
      status: () => 200,
      headers: () => ({ "content-length": "9" }),
      body: async () => {
        bodies += 1;
        return new Uint8Array([1]);
      },
    };
  }), "https://cdn2.onlyfans.com/a.jpg", { maxBytes: 4, userAgent: "Huella-CRM" });
  assert.equal(bytes, null);
  assert.equal(bodies, 0);
  assert.equal(seen[0]?.["user-agent"], "Huella-CRM");
  assert.equal(seen[0]?.cookie, undefined);
});

test("un redirect fuera de OnlyFans no sale del navegador de la sesión", async () => {
  let hops = 0;
  const bytes = await readSessionMedia(client(async () => {
    hops += 1;
    return {
      status: () => 302,
      headers: () => ({ location: "https://evil.example/x" }),
      body: async () => new Uint8Array(),
    };
  }), "https://cdn2.onlyfans.com/a.jpg", { totalMs: 1_000 });
  assert.equal(bytes, null);
  assert.equal(hops, 1);
});

test("el reloj total corta la miniatura de la sesión", async () => {
  const started = Date.now();
  const bytes = await readSessionMedia({
    get: () => new Promise(() => undefined),
  }, "https://cdn2.onlyfans.com/a.jpg", { totalMs: 40 });
  assert.equal(bytes, null);
  assert.ok(Date.now() - started < 400);
});

test("las cabeceras de la sesión conservan la huella y tiran la cookie", () => {
  const headers = new Headers({ cookie: "sess=copiada", range: "bytes=0-1" });
  const safe = sessionHeaders(headers);
  assert.equal(safe.cookie, undefined);
  assert.equal(safe.range, "bytes=0-1");
  assert.equal(safe["user-agent"], BROWSER_FINGERPRINT.userAgent);
});

test("el trozo de vídeo por la sesión tampoco copia cookies", async () => {
  let cookie: string | undefined;
  const opened = await sessionUpstream(client(async (_url, init) => {
    cookie = init.headers?.cookie;
    return {
      status: () => 206,
      headers: () => ({ "content-type": "video/mp4", "content-length": "1" }),
      body: async () => new Uint8Array([4]),
    };
  }), "https://cdn2.onlyfans.com/v.mp4", new Headers({ range: "bytes=0-1", cookie: "sess=copiada" }));
  assert.equal(cookie, undefined);
  assert.equal(opened.status, 206);
  const bytes = await new Response(opened.body ?? undefined).arrayBuffer();
  assert.equal(bytes.byteLength, 1);
});

test("sin content-length la miniatura se corta en streaming y no lee el cuerpo entero", async () => {
  let bodyCalls = 0;
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(new Uint8Array(1_000_000));
    },
    cancel() {
      cancelled = true;
    },
  });
  const bytes = await readSessionMedia(client(async () => ({
    status: () => 200,
    headers: () => ({}),
    stream,
    body: async () => {
      bodyCalls += 1;
      return new Uint8Array([1]);
    },
  })), "https://cdn2.onlyfans.com/a.jpg", { maxBytes: 1_500_000, totalMs: 2_000 });
  assert.equal(bytes, null);
  assert.equal(bodyCalls, 0);
  assert.equal(cancelled, true);
});

test("el trozo con stream no se junta en memoria", async () => {
  let bodyCalls = 0;
  const opened = await sessionUpstream(client(async () => ({
    status: () => 200,
    headers: () => ({ "content-type": "video/mp4" }),
    stream: new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([1]));
        controller.enqueue(new Uint8Array([2]));
        controller.close();
      },
    }),
    body: async () => {
      bodyCalls += 1;
      return new Uint8Array(8);
    },
  })), "https://cdn2.onlyfans.com/v.mp4", new Headers());
  assert.equal(bodyCalls, 0);
  const bytes = new Uint8Array(await new Response(opened.body ?? undefined).arrayBuffer());
  assert.deepEqual([...bytes], [1, 2]);
});

function client(get: SessionRequest["get"]): SessionRequest {
  return { get };
}
