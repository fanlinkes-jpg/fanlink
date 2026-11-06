import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { serveChatMedia, type ChatMediaDeps } from "../sync/media-http.ts";

test("sin permiso /api/chat-media responde 404 por HTTP", async () => {
  const port = await listen(denied());
  try {
    const deniedResponse = await fetch(url(port, "creatorId=c1&threadKey=7&messageKey=m1&index=0"));
    assert.equal(deniedResponse.status, 404);
    const missing = await fetch(url(port, ""));
    assert.equal(missing.status, 404);
    const foreign = await fetch(url(port, "creatorId=c1&threadKey=otro&messageKey=m1&index=0"));
    assert.equal(foreign.status, 404);
  } finally {
    await close(port);
  }
});

test("con el login local apagado un miembro ve la miniatura", async () => {
  const port = await listen({
    ...denied(),
    localOpen: true,
  });
  try {
    const response = await fetch(url(port, "creatorId=c1&threadKey=7&messageKey=m1&index=0"));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "image/png");
  } finally {
    await close(port);
  }
});

const servers = new Map<number, ReturnType<typeof createServer>>();

function denied(): ChatMediaDeps {
  return {
    localOpen: false,
    role: "member",
    perms: [],
    creatorAllowed: () => true,
    findRow: async () => ({ threadKey: "7" }),
    loadThumb: async () => new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    openFull: async () => new Response("no", { status: 500 }),
  };
}

function url(port: number, query: string): string {
  return `http://127.0.0.1:${port}/api/chat-media${query ? `?${query}` : ""}`;
}

function listen(deps: ChatMediaDeps): Promise<number> {
  const server = createServer((req, res) => {
    void serveChatMedia(new Request(`http://127.0.0.1${req.url ?? ""}`), deps).then(async (response) => {
      res.statusCode = response.status;
      response.headers.forEach((value, key) => res.setHeader(key, value));
      res.end(Buffer.from(await response.arrayBuffer()));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      servers.set(address.port, server);
      resolve(address.port);
    });
  });
}

function close(port: number): Promise<void> {
  const server = servers.get(port);
  servers.delete(port);
  return new Promise((resolve) => server?.close(() => resolve()));
}
