import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { handleVaultMedia, handleVaultQuery } from "../http/vault-http.ts";
import { clearVaultThumbs, getVaultThumb, putVaultThumb, setVaultThumbClock, VAULT_THUMB_CACHE_BYTES, VAULT_THUMB_CACHE_MAX } from "../sync/media-bytes.ts";
import { loadFreshPreview, preloadVaultThumbs, reloadVaultPreview, shareRefresh, signedUrlExpired, VAULT_THUMB_PAGE } from "../sync/vault-thumbs.ts";
import { fetchSignedVault } from "../sync/of-chat-api.ts";
import { parseVaultBundle } from "../sync/vault-model.ts";
import { persistVaultRead, storedVaultPage } from "../sync/vault-store.ts";
import { presentCard } from "../sync/vault-query.ts";
import type { ReadSql } from "../sync/store.ts";
import type { SessionManager } from "../sessions/session-manager.ts";
import type { StorageStateFile } from "../sessions/storage-state.ts";
import { readChatVaultView } from "../sync/vault-read.ts";
import { VAULT_THUMB_MISSING, vaultMediaSrc } from "../../../src/lib/chat-media.ts";
import { createSessionRuntime } from "../runtime.ts";
import { recordingFactory, removeDir, tempDataDir, testConfig, testDisplay, completeFixtureLogin } from "./helpers.ts";
import { startFixture } from "./fixture-site.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);
const RULES = {
  static_param: "param",
  format: "1:{}:{:x}:2",
  checksum_indexes: [0, 1],
  checksum_constants: [5, 5],
  checksum_constant: 10,
  app_token: "token",
  remove_headers: [] as string[],
};

describe("miniaturas de la bóveda", { concurrency: 1 }, () => {
  test("tras leer la bóveda, /api/vault-media devuelve la imagen y el cliente no ve el CDN", async () => {
    clearVaultThumbs();
    const db = new PGlite();
    const cdn: string[] = [];
    let mediaCalls = 0;
    try {
      await applyVault(db);
      const future = Math.floor(Date.now() / 1000) + 86_400;
      const fetchImpl = mockFetch({
        cdn,
        onMedia: () => {
          mediaCalls += 1;
          return Array.from({ length: 45 }, (_, index) => mediaRow(index, thumbUrl(index, future)));
        },
        onCdn: (href, init) => {
          assert.equal(sessionHeaders(init), true);
          if (href.includes("cloudfront")) return new Response("no", { status: 403 });
          return new Response(jpeg, { status: 200, headers: { "content-type": "image/jpeg" } });
        },
      });
      const view = await readChatVaultView({ creatorId: "c-thumb", threadKey: "t" }, {
        fetch: fetchImpl,
        sql: asSql(db),
        sessions: fakeSessions(),
        access: { role: "owner", perms: ["mensajes", "vault"] },
      });
      assert.equal(view.reason, null);
      assert.equal(view.items.length, 45);
      assert.equal(mediaCalls, 1);
      assert.equal(cdn.length, VAULT_THUMB_PAGE);
      assert.equal(getVaultThumb("c-thumb", "m40"), null);
      const rawView = JSON.stringify(view);
      assert.equal(rawView.includes("onlyfans.com/"), false);
      assert.equal(rawView.toLowerCase().includes("cloudfront"), false);
      const response = await handleVaultMedia(new Request("http://127.0.0.1/api/vault-media?creatorId=c-thumb&mediaId=m0"), {
        session: async () => ({ userId: "owner", role: "owner", perms: ["mensajes"], creatorIds: ["c-thumb"] }),
        findPreview: async () => {
          throw new Error("la miniatura ya estaba en caché");
        },
        fetchBytes: async () => {
          throw new Error("no hace falta volver a pedir el CDN");
        },
      });
      assert.equal(response.status, 200);
      assert.match(response.headers.get("content-type") ?? "", /^image\//);
      assert.deepEqual(new Uint8Array(await response.arrayBuffer()), jpeg);
      const queried = await handleVaultQuery(jsonRequest({ creatorId: "c-thumb", query: {}, remember: false }), {
        session: async () => ({ userId: "owner", role: "owner", perms: ["mensajes", "vault"], creatorIds: ["c-thumb"] }),
        sql: asSql(db),
      });
      const payload = JSON.stringify(await queried.json());
      assert.equal(payload.includes("onlyfans.com/"), false);
      assert.equal(payload.toLowerCase().includes("cloudfront"), false);
      const card = presentCard(fileWithPreview("https://d111.cloudfront.net/secret.jpg"), [], new Set(), new Set(), new Set(), [], [], null);
      const cardJson = JSON.stringify(card);
      assert.equal(cardJson.includes("onlyfans.com/"), false);
      assert.equal(cardJson.toLowerCase().includes("cloudfront"), false);
      assert.equal(vaultMediaSrc("c-thumb", "m0").includes("onlyfans.com/"), false);
      assert.equal(VAULT_THUMB_MISSING, "Sin miniatura");
    } finally {
      await db.close();
      clearVaultThumbs();
    }
  });

  test("un 403 del CDN refresca vault/media una vez y usa la URL nueva", async () => {
    clearVaultThumbs();
    const db = new PGlite();
    const cdn: string[] = [];
    const lines: string[] = [];
    const stale = thumbUrl(0, Math.floor(Date.now() / 1000) + 86_400);
    const fresh = thumbUrl(1, Math.floor(Date.now() / 1000) + 86_400).replace("/m1/", "/nueva/");
    let mediaCalls = 0;
    const original = console.info;
    console.info = (...args: unknown[]) => {
      lines.push(args.map((item) => String(item)).join(" "));
    };
    try {
      await applyVault(db);
      const fetchImpl = mockFetch({
        cdn,
        onMedia: () => {
          mediaCalls += 1;
          const url = mediaCalls === 1 ? stale : fresh;
          return [mediaRow(0, url)];
        },
        onCdn: (href, init) => {
          assert.equal(sessionHeaders(init), true);
          if (href === fresh) return new Response(jpeg, { status: 200, headers: { "content-type": "image/jpeg" } });
          return new Response("caducada", { status: 403 });
        },
      });
      const view = await readChatVaultView({ creatorId: "c-thumb", threadKey: "t" }, {
        fetch: fetchImpl,
        sql: asSql(db),
        sessions: fakeSessions(),
        access: { role: "owner", perms: ["mensajes"] },
      });
      assert.equal(view.items[0]?.id, "m0");
      assert.equal(mediaCalls, 2);
      assert.deepEqual(cdn, [stale, fresh]);
      assert.equal(lines.some((line) => line.includes("miniatura status=403")), true);
      assert.equal(lines.some((line) => line.includes("onlyfans.com/")), false);
      const response = await handleVaultMedia(new Request("http://127.0.0.1/api/vault-media?creatorId=c-thumb&mediaId=m0"), {
        session: async () => ({ userId: "owner", role: "owner", perms: ["vault"], creatorIds: ["c-thumb"] }),
        findPreview: async () => stale,
        fetchBytes: async () => null,
      });
      assert.equal(response.status, 200);
      assert.match(response.headers.get("content-type") ?? "", /^image\//);
    } finally {
      console.info = original;
      await db.close();
      clearVaultThumbs();
    }
  });

  test("el segundo 403 no dispara otro vault/media", async () => {
    clearVaultThumbs();
    const seen: string[] = [];
    let reloads = 0;
    const stale = thumbUrl(7, Math.floor(Date.now() / 1000) + 3_600);
    const next = thumbUrl(8, Math.floor(Date.now() / 1000) + 3_600);
    const media = await loadFreshPreview({
      creatorId: "c-retry",
      mediaId: "m7",
      url: stale,
      read: async (url) => {
        seen.push(url);
        return { status: url === next ? 410 : 403, media: null };
      },
      reload: async () => {
        reloads += 1;
        return next;
      },
    });
    assert.equal(media, null);
    assert.equal(reloads, 1);
    assert.deepEqual(seen, [stale, next]);
    assert.equal(getVaultThumb("c-retry", "m7"), null);
    clearVaultThumbs();
  });

  test("una URL ya caducada no se pide: se sustituye antes", async () => {
    clearVaultThumbs();
    const cdn: string[] = [];
    const stale = "https://cdn2.onlyfans.com/files/vieja/thumb.jpg?Expires=1600000000";
    const fresh = thumbUrl(3, Math.floor(Date.now() / 1000) + 86_400);
    const policy = Buffer.from(JSON.stringify({
      Statement: [{ Condition: { DateLessThan: { "AWS:EpochTime": 1_000 } } }],
    })).toString("base64url");
    assert.equal(signedUrlExpired(stale, Date.now()), true);
    assert.equal(signedUrlExpired(`https://cdn2.onlyfans.com/files/p/thumb.jpg?Policy=${policy}`, Date.now()), true);
    assert.equal(signedUrlExpired(fresh, Date.now()), false);
    let refreshes = 0;
    const stored = await preloadVaultThumbs({
      creatorId: "c-exp",
      items: [{ id: "vieja", preview: stale }],
      fetch: mockFetch({
        cdn,
        onMedia: () => [],
        onCdn: (href) => {
          if (href === fresh) return new Response(jpeg, { status: 200, headers: { "content-type": "image/jpeg" } });
          return new Response("no", { status: 403 });
        },
      }),
      headers: {
        cookie: "auth_id=42; sess=ok",
        referer: "https://onlyfans.com/",
        "user-agent": "Chrome",
        accept: "image/*",
      },
      now: Date.now(),
      refreshPage: async () => {
        refreshes += 1;
        return [{ id: "vieja", preview: fresh }];
      },
      openBrowser: async () => {
        throw new Error("la URL nueva ya vale por HTTP");
      },
    });
    assert.equal(refreshes, 1);
    assert.equal(stored, 1);
    assert.deepEqual(cdn, [fresh]);
    assert.equal(getVaultThumb("c-exp", "vieja")?.contentType, "image/jpeg");
    clearVaultThumbs();
  });

  test("la caché aguanta dos páginas y olvida lo que pasa del tope o del TTL", () => {
    clearVaultThumbs();
    for (let index = 0; index < 80; index += 1) putVaultThumb("c-cache", `p${index}`, jpeg, "image/jpeg");
    assert.ok(getVaultThumb("c-cache", "p0"));
    assert.ok(getVaultThumb("c-cache", "p79"));
    clearVaultThumbs();
    for (let index = 0; index < VAULT_THUMB_CACHE_MAX + 1; index += 1) {
      putVaultThumb("c-cache", `n${index}`, jpeg, "image/jpeg");
    }
    assert.equal(getVaultThumb("c-cache", "n0"), null);
    assert.ok(getVaultThumb("c-cache", `n${VAULT_THUMB_CACHE_MAX}`));
    clearVaultThumbs();
    let now = 5_000_000_000;
    setVaultThumbClock(() => now);
    try {
      putVaultThumb("c-cache", "ttl", jpeg, "image/jpeg");
      now += 10 * 60_000 + 1;
      assert.equal(getVaultThumb("c-cache", "ttl"), null);
    } finally {
      setVaultThumbClock(() => Date.now());
      clearVaultThumbs();
    }
  });

  test("un 403 de la página 2 relee ese offset", async () => {
    clearVaultThumbs();
    const seen: string[] = [];
    const future = Math.floor(Date.now() / 1000) + 86_400;
    const stale = thumbUrl(8, future);
    const fresh = thumbUrl(9, future);
    const fetchImpl: typeof fetch = async (target) => {
      const href = String(target);
      seen.push(href);
      if (href.includes("dynamic-rules")) return Response.json(RULES);
      if (href.includes("/vault/media")) return Response.json({ list: [mediaRow(9, fresh)] });
      return new Response("no", { status: 404 });
    };
    const media = await loadFreshPreview({
      creatorId: "c-page",
      mediaId: "m9",
      url: stale,
      read: async (url) => url === fresh
        ? { status: 200, media: { status: 200, body: jpeg, contentType: "image/jpeg" } }
        : { status: 403, media: null },
      reload: () => reloadVaultPreview({
        creatorId: "c-page",
        mediaId: "m9",
        listId: "sets",
        offset: 40,
        loadPage: async (listId, offset) => {
          const payloads = await fetchSignedVault(storageState(), { fetch: fetchImpl, now: () => Date.now() }, listId, offset);
          return payloads.flatMap((payload) => parseVaultBundle(payload).items);
        },
      }),
    });
    assert.equal(media?.contentType, "image/jpeg");
    assert.equal(seen.some((href) => href.includes("offset=40") && href.includes("list=sets")), true);
    assert.equal(seen.some((href) => href.includes("/vault/media") && href.includes("offset=0")), false);
    const db = new PGlite();
    try {
      await applyVault(db);
      await persistVaultRead(asSql(db), "c-page", [{ list: [mediaRow(9, fresh)] }], { listId: "sets", offset: 40 });
      const page = await storedVaultPage(asSql(db), "c-page", "m9");
      assert.equal(page?.listId, "sets");
      assert.equal(page?.offset, 40);
    } finally {
      await db.close();
      clearVaultThumbs();
    }
  });

  test("dos creadoras con el mismo mediaId no comparten la relectura", async () => {
    const seen: string[] = [];
    const future = Math.floor(Date.now() / 1000) + 86_400;
    await Promise.all(["c-a", "c-b"].map((creatorId) => reloadVaultPreview({
      creatorId,
      mediaId: "mismo",
      listId: "all",
      offset: 40,
      loadPage: async (listId, offset) => {
        seen.push(`${creatorId}:${listId}:${offset}`);
        await new Promise((resolve) => setTimeout(resolve, 15));
        return [{ id: "mismo", preview: thumbUrl(creatorId === "c-a" ? 1 : 2, future) }];
      },
    })));
    assert.deepEqual(seen.sort(), ["c-a:all:40", "c-b:all:40"]);
  });

  test("dos GET simultáneos del mismo medio piden vault/media una vez", async () => {
    let loads = 0;
    const future = Math.floor(Date.now() / 1000) + 86_400;
    const preview = thumbUrl(3, future);
    const loadPage = async () => {
      loads += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return [{ id: "mismo", preview }];
    };
    const [left, right] = await Promise.all([
      reloadVaultPreview({ creatorId: "c-a", mediaId: "mismo", listId: "all", offset: 40, loadPage }),
      reloadVaultPreview({ creatorId: "c-a", mediaId: "mismo", listId: "all", offset: 40, loadPage }),
    ]);
    assert.equal(loads, 1);
    assert.equal(left, preview);
    assert.equal(right, preview);
  });

  test("si la relectura sigue en 403 se pide el perfil una vez y se suelta", async () => {
    clearVaultThumbs();
    let opened = 0;
    let released = 0;
    const future = Math.floor(Date.now() / 1000) + 86_400;
    const fresh = thumbUrl(5, future);
    const media = await loadFreshPreview({
      creatorId: "c-borrow",
      mediaId: "m4",
      url: thumbUrl(4, future),
      read: async () => ({ status: 403, media: null }),
      reload: async () => fresh,
      openBrowser: async () => {
        opened += 1;
        return {
          get: async (url) => {
            assert.equal(url, fresh);
            return { ok: true, status: 200, body: jpeg, contentType: "image/jpeg" };
          },
          release: async () => {
            released += 1;
          },
        };
      },
    });
    assert.equal(opened, 1);
    assert.equal(released, 1);
    assert.equal(media?.contentType, "image/jpeg");
    clearVaultThumbs();
  });

  test("la caché no pasa del tope de bytes", () => {
    clearVaultThumbs();
    putVaultThumb("c-bytes", "grande", new Uint8Array(VAULT_THUMB_CACHE_BYTES), "image/jpeg");
    putVaultThumb("c-bytes", "pequeña", jpeg, "image/jpeg");
    assert.equal(getVaultThumb("c-bytes", "grande"), null);
    assert.ok(getVaultThumb("c-bytes", "pequeña"));
    putVaultThumb("c-bytes", "demasiado", new Uint8Array(VAULT_THUMB_CACHE_BYTES + 1), "image/jpeg");
    assert.equal(getVaultThumb("c-bytes", "demasiado"), null);
    assert.ok(getVaultThumb("c-bytes", "pequeña"));
    clearVaultThumbs();
  });

  test("varias miniaturas comparten un solo refresco", async () => {
    let loads = 0;
    const load = async () => {
      loads += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return [{ id: "a", preview: thumbUrl(0, Math.floor(Date.now() / 1000) + 60) }];
    };
    const [left, right] = await Promise.all([shareRefresh("c-share", load), shareRefresh("c-share", load)]);
    assert.equal(loads, 1);
    assert.equal(left, right);
  });

  test("abrir la bóveda y pedir 40 miniaturas no abre un segundo Chromium", async () => {
    clearVaultThumbs();
    const dataDir = await tempDataDir();
    const fixture = await startFixture();
    const events: string[] = [];
    const db = new PGlite();
    const runtime = await createSessionRuntime({
      config: testConfig(dataDir),
      site: fixture.site,
      browserFactory: recordingFactory(events),
      displayEnv: testDisplay,
      afterLoginPageOpen: (page) => completeFixtureLogin(page),
    });
    const launches = () => events.filter((event) => event.startsWith("persistent:") || event.startsWith("context:")).length;
    try {
      await applyVault(db);
      const account = await runtime.sessions.addAccount("Principal", "c-browser");
      await runtime.sessions.whenLoginSettled(account.id);
      const afterLogin = launches();
      assert.ok(afterLogin >= 1);
      const future = Math.floor(Date.now() / 1000) + 86_400;
      await readChatVaultView({ creatorId: "c-browser", threadKey: "t" }, {
        fetch: pageFetch(40, (index) => thumbUrl(index, future), () => new Response(jpeg, { status: 200, headers: { "content-type": "image/jpeg" } })),
        sql: asSql(db),
        sessions: wrapped(runtime.sessions, account.id, true),
        access: { role: "owner", perms: ["mensajes"] },
      });
      assert.equal(launches(), afterLogin);
      assert.equal(getVaultThumb("c-browser", "m0")?.contentType, "image/jpeg");
      assert.equal(getVaultThumb("c-browser", "m39")?.contentType, "image/jpeg");

      clearVaultThumbs();
      let borrows = 0;
      await readChatVaultView({ creatorId: "c-browser", threadKey: "t" }, {
        fetch: pageFetch(40, (index) => thumbUrl(index, future), () => new Response("no", { status: 403 })),
        sql: asSql(db),
        sessions: wrapped(runtime.sessions, account.id, false),
        access: { role: "owner", perms: ["mensajes"] },
        openBrowser: async () => {
          borrows += 1;
          const borrowed = await runtime.sessions.borrowProfile(account.id);
          return {
            get: async () => ({ ok: true, status: 200, body: jpeg, contentType: "image/jpeg" }),
            release: () => borrowed.release(),
          };
        },
      });
      assert.equal(borrows, 1);
      assert.equal(launches(), afterLogin + 1);

      clearVaultThumbs();
      let release: () => void = () => undefined;
      const stopped = new Promise<void>((resolve) => {
        release = resolve;
      });
      let ready: () => void = () => undefined;
      const watching = new Promise<void>((resolve) => {
        ready = resolve;
      });
      const held = runtime.sessions.holdWatch(account.id, async () => {
        ready();
        await stopped;
      });
      await watching;
      const whileOpen = launches();
      borrows = 0;
      await readChatVaultView({ creatorId: "c-browser", threadKey: "t", offset: 40 }, {
        fetch: pageFetch(40, (index) => thumbUrl(index + 40, future), () => new Response("no", { status: 410 })),
        sql: asSql(db),
        sessions: wrapped(runtime.sessions, account.id, false),
        access: { role: "owner", perms: ["mensajes"] },
        openBrowser: async () => {
          borrows += 1;
          const borrowed = await runtime.sessions.borrowProfile(account.id);
          return {
            get: async () => ({ ok: true, status: 200, body: jpeg, contentType: "image/jpeg" }),
            release: () => borrowed.release(),
          };
        },
      });
      assert.equal(borrows, 1);
      assert.equal(launches(), whileOpen);
      release();
      await held;
    } finally {
      await runtime.close();
      await fixture.close();
      await removeDir(dataDir);
      await db.close();
      clearVaultThumbs();
    }
  });
});

function pageFetch(count: number, urlFor: (index: number) => string, cdn: () => Response): typeof fetch {
  return mockFetch({
    cdn: [],
    onMedia: () => Array.from({ length: count }, (_, index) => mediaRow(index, urlFor(index))),
    onCdn: (_href, init) => {
      if (!sessionHeaders(init)) return new Response("no", { status: 403 });
      return cdn();
    },
  });
}

function mockFetch(input: {
  cdn: string[];
  onMedia: () => Array<ReturnType<typeof mediaRow>>;
  onCdn: (href: string, init?: RequestInit) => Response;
}): typeof fetch {
  return async (target, init) => {
    const href = String(target);
    if (href.includes("dynamic-rules")) return Response.json(RULES);
    if (href.includes("/vault/lists")) return Response.json({ lists: [] });
    if (href.includes("/vault/media")) return Response.json({ list: input.onMedia() });
    if (href.includes("onlyfans.com/") || href.includes("cloudfront")) {
      input.cdn.push(href);
      return input.onCdn(href, init);
    }
    return new Response("no", { status: 404 });
  };
}

function sessionHeaders(init?: RequestInit): boolean {
  const headers = new Headers(init?.headers);
  const cookie = headers.get("cookie") ?? "";
  return cookie.includes("sess=") && headers.get("referer") === "https://onlyfans.com/" && (headers.get("user-agent") ?? "").includes("Chrome");
}

function mediaRow(index: number, url: string): { id: string; type: string; files: { thumb: { url: string } } } {
  return { id: `m${index}`, type: "photo", files: { thumb: { url } } };
}

function thumbUrl(index: number, expires: number): string {
  return `https://cdn2.onlyfans.com/files/m${index}/thumb.jpg?Expires=${expires}`;
}

function fakeSessions(): Pick<SessionManager, "listAccounts" | "readStorageState" | "borrowProfile"> {
  return {
    async listAccounts() {
      return [{
        id: "acc-thumb",
        creatorId: "c-thumb",
        hasStorageState: true,
      }] as Awaited<ReturnType<SessionManager["listAccounts"]>>;
    },
    async readStorageState() {
      return storageState();
    },
    async borrowProfile() {
      throw new Error("esta lectura no abre Chromium");
    },
  };
}

function wrapped(
  sessions: SessionManager,
  accountId: string,
  blockBrowser: boolean,
): Pick<SessionManager, "listAccounts" | "readStorageState" | "borrowProfile"> {
  return {
    listAccounts: () => sessions.listAccounts(),
    async readStorageState() {
      return storageState();
    },
    async borrowProfile(id: string) {
      assert.equal(id, accountId);
      if (blockBrowser) throw new Error("el HTTP ya trajo las miniaturas");
      return sessions.borrowProfile(id);
    },
  };
}

function storageState(): StorageStateFile {
  return {
    cookies: [
      cookie("auth_id", "42"),
      cookie("sess", "ok"),
    ],
    origins: [{ origin: "https://onlyfans.com", localStorage: [{ name: "bcTokenSha", value: "huella" }] }],
  };
}

function cookie(name: string, value: string): StorageStateFile["cookies"][number] {
  return {
    name,
    value,
    domain: ".onlyfans.com",
    path: "/",
    expires: -1,
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
  };
}

function fileWithPreview(preview: string) {
  return {
    id: "m0",
    title: "Foto",
    kind: "foto" as const,
    seconds: null,
    preview,
    folder: null,
    tags: [],
    listId: null,
    listName: null,
    description: null,
    uploadedAt: null,
    priceCents: null,
    salesCount: null,
    sentCount: null,
  };
}

function jsonRequest(body: unknown): Request {
  return new Request("http://127.0.0.1/api/vault-query", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function asSql(db: PGlite): ReadSql {
  return {
    async query<T>(text: string, params?: unknown[]): Promise<T[]> {
      const result = await db.query<T>(text, params);
      return result.rows;
    },
  };
}

async function applyVault(db: PGlite): Promise<void> {
  for (const file of ["0037_vault_mirror.sql", "0038_vault_fan_filter.sql", "0040_vault_full_tags.sql", "0042_vault_paid_with.sql", "0044_vault_thumb_page.sql"]) {
    await db.exec(await readFile(path.join(root, "migrations", file), "utf8"));
  }
}
