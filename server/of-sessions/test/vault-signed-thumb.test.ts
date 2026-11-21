import assert from "node:assert/strict";
import test from "node:test";
import { clearVaultThumbs, getVaultThumb } from "../sync/media-bytes.ts";
import { preloadVaultThumbs } from "../sync/vault-thumbs.ts";

const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);
const future = "9999999999";

test("un 403 sin cookie se recupera con la sesión y no se anota una vez por miniatura", async () => {
  clearVaultThumbs();
  const lines: string[] = [];
  const previous = console.info;
  console.info = (line?: unknown) => {
    lines.push(String(line));
  };
  let bare = 0;
  let authed = 0;
  try {
    const stored = await preloadVaultThumbs({
      creatorId: "vtdcoi5",
      items: Array.from({ length: 8 }, (_, index) => ({
        id: `m${index}`,
        preview: `https://cdn2.onlyfans.com/files/m${index}/square.jpg?Expires=${future}`,
      })),
      fetch: (async (_input: RequestInfo | URL, init?: RequestInit) => {
        const cookie = new Headers(init?.headers).get("cookie") ?? "";
        if (!cookie.includes("sess=")) {
          bare += 1;
          return new Response("no", { status: 403 });
        }
        authed += 1;
        return new Response(jpeg, { status: 200, headers: { "content-type": "image/jpeg" } });
      }) as typeof fetch,
      headers: {
        accept: "image/*",
        referer: "https://onlyfans.com/",
        "user-agent": "Chrome",
        cookie: "auth_id=1; sess=ok",
      },
      now: Date.now(),
      refreshPage: async () => {
        throw new Error("no hace falta refrescar");
      },
    });
    assert.equal(stored, 8);
    assert.equal(bare, 8);
    assert.equal(authed, 8);
    assert.equal(lines.filter((line) => line.includes("miniatura status=403")).length, 0);
    assert.equal(getVaultThumb("vtdcoi5", "m7")?.contentType, "image/jpeg");
  } finally {
    console.info = previous;
    clearVaultThumbs();
  }
});

test("si la sesión también recibe 403 se refresca la URL firmada una sola vez", async () => {
  clearVaultThumbs();
  const lines: string[] = [];
  const previous = console.info;
  console.info = (line?: unknown) => {
    lines.push(String(line));
  };
  let refreshes = 0;
  try {
    const stored = await preloadVaultThumbs({
      creatorId: "3zk7kbr",
      items: [0, 1].map((index) => ({
        id: `v${index}`,
        preview: `https://cdn2.onlyfans.com/files/vieja${index}/square.jpg?Expires=${future}`,
      })),
      fetch: (async (input: RequestInfo | URL) => {
        const href = String(input);
        if (href.includes("/nueva")) return new Response(jpeg, { status: 200, headers: { "content-type": "image/jpeg" } });
        return new Response("no", { status: 403 });
      }) as typeof fetch,
      headers: {
        accept: "image/*",
        referer: "https://onlyfans.com/",
        "user-agent": "Chrome",
        cookie: "auth_id=1; sess=ok",
      },
      now: Date.now(),
      refreshPage: async () => {
        refreshes += 1;
        return [0, 1].map((index) => ({
          id: `v${index}`,
          preview: `https://cdn2.onlyfans.com/files/nueva${index}/square.jpg?Expires=${future}`,
        }));
      },
    });
    assert.equal(refreshes, 1);
    assert.equal(stored, 2);
    assert.equal(lines.filter((line) => line.includes("[fanlink:vault] miniatura status=403")).length, 1);
    assert.equal(getVaultThumb("3zk7kbr", "v0")?.contentType, "image/jpeg");
  } finally {
    console.info = previous;
    clearVaultThumbs();
  }
});
