import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { clearAccountChatPace } from "../sync/api-list-pace.ts";
import { fetchSignedVault } from "../sync/of-chat-api.ts";
import { clearSignRulesCache } from "../sync/of-sign.ts";
import type { StorageStateFile } from "../sessions/storage-state.ts";
import type { ReadSql } from "../sync/store.ts";
import { vaultFolderLabel } from "../../../src/lib/vault-folder-label.ts";
import { emptyVaultQuery } from "../sync/vault-filter.ts";
import { queryVaultForActor } from "../sync/vault-query.ts";
import { clearVaultWalkCache, walkVault } from "../sync/vault-walk.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const RULES = {
  static_param: "param",
  format: "1:{}:{:x}:2",
  checksum_indexes: [0, 1],
  checksum_constants: [5, 5],
  checksum_constant: 10,
  app_token: "token",
  remove_headers: ["user-id"],
};

test("cada lista trae su conteo y sus medios, paginando hasMore", async () => {
  clearSignRulesCache();
  clearVaultWalkCache();
  const db = new PGlite();
  const seen: string[] = [];
  try {
    for (const file of ["0037_vault_mirror.sql", "0038_vault_fan_filter.sql", "0040_vault_full_tags.sql", "0042_vault_paid_with.sql", "0044_vault_thumb_page.sql", "0050_vault_list_counts.sql", "0051_vault_list_media.sql"]) {
      await db.exec(await readFile(path.join(root, "migrations", file), "utf8"));
    }
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const href = String(input);
      seen.push(href);
      if (href.includes("dynamic-rules")) return Response.json(RULES);
      if (href.includes("/vault/lists")) {
        return Response.json({
          lists: [
            { id: "cuarteto", name: "B/B/B/G EL CUARTETO GANGBANG", photosCount: 3, videosCount: 8, hasMedia: true },
            { id: "ducha", name: "B/G LA DUCHA", photosCount: 0, videosCount: 2, hasMedia: true },
          ],
          hasMore: false,
        });
      }
      const url = new URL(href);
      const list = url.searchParams.get("list");
      const offset = Number(url.searchParams.get("offset") ?? "0");
      if (!list || list === "all") {
        if (offset === 0) return Response.json({ list: [{ id: 1, type: "photo" }], hasMore: true });
        return Response.json({ list: [{ id: 2, type: "video", duration: 4 }], hasMore: false });
      }
      if (list === "cuarteto") return Response.json({ list: [{ id: 30, type: "video", duration: 9 }, { id: 31, type: "photo" }], hasMore: false });
      if (list === "ducha") return Response.json({ list: [{ id: 40, type: "video", duration: 3 }], hasMore: false });
      return Response.json({ list: [], hasMore: false });
    }) as typeof fetch;
    const walked = await walkVault({
      creatorId: "vtdcoi5",
      state: storedState(),
      fetch: fetchImpl,
      now: () => 1_700_000_000_000,
      sql: asSql(db),
      sleep: async () => undefined,
    });
    assert.equal(walked.reason, null);
    assert.equal(seen.filter((href) => href.includes("/vault/media") && href.includes("list=all") && href.includes("offset=0")).length, 1);
    assert.equal(seen.some((href) => href.includes("/vault/media") && href.includes("list=all") && href.includes("offset=1")), true);
    assert.equal(seen.some((href) => href.includes("list=cuarteto")), true);
    assert.equal(seen.some((href) => href.includes("list=ducha")), true);
    assert.equal(seen.some((href) => href.includes("/vault/lists") && href.includes("limit=50")), true);
    assert.equal(seen.some((href) => href.includes("/vault/media") && href.includes("limit=40") && href.includes("sort=desc") && href.includes("list=all") && !href.includes("list_id=") && !href.includes("field=")), true);
    const view = await queryVaultForActor(asSql(db), { userId: "dueña", role: "owner", perms: ["vault"] }, {
      creatorId: "vtdcoi5",
      remember: false,
      query: { ...emptyVaultQuery(), folderId: "cuarteto", scope: "carpeta" },
    });
    assert.equal(view.status, 200);
    const folder = view.payload.lists.find((list) => list.id === "cuarteto");
    assert.equal(folder?.photos, 3);
    assert.equal(folder?.videos, 8);
    assert.equal(folder?.name, "B/B/B/G EL CUARTETO GANGBANG");
    assert.deepEqual(view.payload.items.map((item) => item.id).sort(), ["30", "31"]);
    const ducha = await queryVaultForActor(asSql(db), { userId: "dueña", role: "owner", perms: ["vault"] }, {
      creatorId: "vtdcoi5",
      remember: false,
      query: { ...emptyVaultQuery(), folderId: "ducha", scope: "carpeta" },
    });
    assert.deepEqual(ducha.payload.items.map((item) => item.id), ["40"]);
    assert.equal(ducha.payload.lists.find((list) => list.id === "ducha")?.videos, 2);
  } finally {
    clearSignRulesCache();
    clearVaultWalkCache();
    await db.close();
  }
});

test("las carpetas en list no cortan los medios y la página siguiente trae las personalizadas", async () => {
  clearSignRulesCache();
  clearVaultWalkCache();
  const db = new PGlite();
  const seen: string[] = [];
  const lines: string[] = [];
  const previous = console.info;
  console.info = (line?: unknown) => {
    lines.push(String(line));
  };
  const system = [
    { id: 30436421, type: "stories", name: "Historias", photosCount: 0, videosCount: 0, gifsCount: 0, audiosCount: 0, hasMedia: false },
    { id: 30436422, type: "posts", name: "Publicaciones", photosCount: 0, videosCount: 0, gifsCount: 0, audiosCount: 0, hasMedia: false },
    { id: 30436423, type: "messages", name: "Mensajes", photosCount: 6, videosCount: 0, gifsCount: 0, audiosCount: 0, hasMedia: true },
    { id: 30436424, type: "streams", name: "Transmisiones", photosCount: 0, videosCount: 0, gifsCount: 0, audiosCount: 0, hasMedia: false },
    { id: 30436425, type: "media", name: "Cargas", photosCount: 0, videosCount: 0, gifsCount: 0, audiosCount: 0, hasMedia: false },
  ];
  try {
    for (const file of ["0037_vault_mirror.sql", "0038_vault_fan_filter.sql", "0040_vault_full_tags.sql", "0042_vault_paid_with.sql", "0044_vault_thumb_page.sql", "0050_vault_list_counts.sql", "0051_vault_list_media.sql"]) {
      await db.exec(await readFile(path.join(root, "migrations", file), "utf8"));
    }
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const href = String(input);
      seen.push(href);
      if (href.includes("dynamic-rules")) return Response.json(RULES);
      if (href.includes("/vault/lists")) {
        const offset = Number(new URL(href).searchParams.get("offset") ?? "0");
        if (offset === 0) {
          return Response.json({
            list: system,
            all: { photosCount: 22, videosCount: 18, gifsCount: 1, audiosCount: 0 },
            hasMore: true,
            canCreateVaultLists: true,
          });
        }
        return Response.json({
          list: [{ id: "ducha", type: "custom", name: "B/G LA DUCHA", photosCount: 4, videosCount: 2, gifsCount: 0, audiosCount: 0, hasMedia: true }],
          hasMore: false,
        });
      }
      const url = new URL(href);
      const list = url.searchParams.get("list");
      const offset = Number(url.searchParams.get("offset") ?? "0");
      if (!list || list === "all") {
        if (offset === 0) return Response.json({ list: Array.from({ length: 24 }, (_, index) => ({ id: index + 1, type: "photo" })), hasMore: true });
        return Response.json({ list: Array.from({ length: 6 }, (_, index) => ({ id: 100 + index, type: "photo" })), hasMore: false });
      }
      if (list === "ducha") return Response.json({ list: [{ id: 40, type: "video", duration: 3 }], hasMore: false });
      return Response.json({ list: [], hasMore: false });
    }) as typeof fetch;
    const walked = await walkVault({
      creatorId: "3zk7kbr",
      state: storedState(),
      fetch: fetchImpl,
      now: () => 1_700_000_000_000,
      sql: asSql(db),
      sleep: async () => undefined,
    });
    assert.equal(walked.reason, null);
    assert.equal(walked.items.length, 30);
    assert.equal(seen.some((href) => href.includes("/vault/lists") && href.includes("offset=5")), true);
    assert.equal(seen.some((href) => href.includes("/vault/media") && href.includes("offset=24") && href.includes("list=all")), true);
    assert.equal(seen.some((href) => href.includes("list=ducha")), true);
    assert.equal(lines.some((line) => line.includes("pagina ruta=/api2/v2/vault/media") && line.includes("offset=0") && line.includes("n=24") && line.includes("hasMore=si") && line.includes("list=all")), true);
    assert.equal(lines.some((line) => line.includes("respuesta ruta=lists") && line.includes("itemClaves=") && line.includes("photosCount")), true);
    assert.equal(lines.some((line) => line.includes("lista id=ducha") && line.includes("fotos=4") && line.includes("videos=2") && line.includes("photosCount")), true);
    assert.equal(lines.some((line) => line.includes("claves=ninguna")), false);
    const view = await queryVaultForActor(asSql(db), { userId: "dueña", role: "owner", perms: ["vault"] }, {
      creatorId: "3zk7kbr",
      remember: false,
      query: { ...emptyVaultQuery(), folderId: "ducha", scope: "carpeta" },
    });
    assert.equal(view.payload.lists.find((list) => list.id === "ducha")?.photos, 4);
    assert.deepEqual(view.payload.items.map((item) => item.id), ["40"]);
  } finally {
    console.info = previous;
    clearSignRulesCache();
    clearVaultWalkCache();
    await db.close();
  }
});

test("sin hasMore sigue mientras la página de medios viene llena", async () => {
  clearSignRulesCache();
  clearVaultWalkCache();
  const db = new PGlite();
  const seen: string[] = [];
  try {
    for (const file of ["0037_vault_mirror.sql", "0038_vault_fan_filter.sql", "0040_vault_full_tags.sql", "0042_vault_paid_with.sql", "0044_vault_thumb_page.sql", "0050_vault_list_counts.sql", "0051_vault_list_media.sql"]) {
      await db.exec(await readFile(path.join(root, "migrations", file), "utf8"));
    }
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const href = String(input);
      seen.push(href);
      if (href.includes("dynamic-rules")) return Response.json(RULES);
      if (href.includes("/vault/lists")) {
        return Response.json({
          list: [{ id: 30436421, type: "stories", name: "Historias", photosCount: 0, videosCount: 0, gifsCount: 0, audiosCount: 0, hasMedia: false }],
          hasMore: false,
        });
      }
      const offset = Number(new URL(href).searchParams.get("offset") ?? "0");
      const size = offset === 0 ? 40 : 3;
      return Response.json({ list: Array.from({ length: size }, (_, index) => ({ id: offset + index + 1, type: "photo" })), hasMore: false });
    }) as typeof fetch;
    const walked = await walkVault({
      creatorId: "3zk7kbr",
      state: storedState(),
      fetch: fetchImpl,
      now: () => 1_700_000_000_000,
      sql: asSql(db),
      sleep: async () => undefined,
    });
    assert.equal(walked.items.length, 43);
    assert.equal(seen.some((href) => href.includes("/vault/media") && href.includes("offset=40")), true);
  } finally {
    clearSignRulesCache();
    clearVaultWalkCache();
    await db.close();
  }
});

test("dos lecturas de la misma cuenta esperan el hueco y no salen a la vez", async () => {
  clearSignRulesCache();
  clearAccountChatPace();
  let active = 0;
  let max = 0;
  const waits: number[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const href = String(input);
    if (href.includes("dynamic-rules")) return Response.json(RULES);
    active += 1;
    max = Math.max(max, active);
    await new Promise((resolve) => setTimeout(resolve, 20));
    active -= 1;
    return Response.json({ list: [{ id: 1, type: "photo" }], hasMore: false });
  }) as typeof fetch;
  const deps = {
    fetch: fetchImpl,
    now: () => Date.now(),
    accountId: "acc-boveda",
    sleep: async (ms: number) => {
      waits.push(ms);
    },
  };
  try {
    await Promise.all([
      fetchSignedVault(storedState(), deps, "all", 0, { includeLists: false, includeMedia: true }),
      fetchSignedVault(storedState(), deps, "all", 24, { includeLists: false, includeMedia: true }),
    ]);
    assert.equal(max, 1);
    assert.equal(waits.length > 0, true);
    assert.equal(waits.every((ms) => ms > 0 && ms <= 300), true);
  } finally {
    clearSignRulesCache();
    clearAccountChatPace();
  }
});

test("una subcarpeta custom usa photos, videos y list_id, y no se filtra por el título", async () => {
  clearSignRulesCache();
  clearVaultWalkCache();
  const db = new PGlite();
  const seen: string[] = [];
  const lines: string[] = [];
  const previous = console.info;
  console.info = (line?: unknown) => {
    lines.push(String(line));
  };
  try {
    for (const file of ["0037_vault_mirror.sql", "0038_vault_fan_filter.sql", "0040_vault_full_tags.sql", "0042_vault_paid_with.sql", "0044_vault_thumb_page.sql", "0050_vault_list_counts.sql", "0051_vault_list_media.sql"]) {
      await db.exec(await readFile(path.join(root, "migrations", file), "utf8"));
    }
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const href = String(input);
      seen.push(href);
      if (href.includes("dynamic-rules")) return Response.json(RULES);
      if (href.includes("/vault/lists")) {
        const offset = Number(new URL(href).searchParams.get("offset") ?? "0");
        if (offset === 0) {
          return Response.json({
            list: [
              { id: 88001, type: "custom", name: "Custom Num", photos: 7, videos: 1 },
              { id: "88001", name: "Custom Num", stats: { gifs: 2, audios: 0 } },
            ],
            all: { photos: 22, videos: 18 },
            hasMore: true,
          });
        }
        return Response.json({
          list: [
            { id: "sub", type: "custom", name: "Sub", bag: { photos: 3, videos: 4 } },
            { id: "solo", type: "custom", name: "Solo", count: 9 },
          ],
          hasMore: false,
        });
      }
      const url = new URL(href);
      const list = url.searchParams.get("list");
      const offset = Number(url.searchParams.get("offset") ?? "0");
      if (!list || list === "all") {
        if (offset !== 0) return Response.json({ list: [{ id: 600, type: "video", duration: 2 }, { id: 601, type: "photo" }], hasMore: false });
        return Response.json({
          list: [
            ...Array.from({ length: 23 }, (_, index) => ({ id: index + 1, type: "photo" })),
            { id: 500, type: "photo", listStates: [{ id: "otra", type: "custom", name: "Custom Num" }] },
          ],
          hasMore: true,
        });
      }
      if (!list) return Response.json({ list: [{ id: 600, type: "video", duration: 2 }, { id: 601, type: "photo" }], hasMore: false });
      if (list === "88001") return Response.json({ list: [{ id: 701, type: "photo" }, { id: "702", type: "video", duration: 4 }], hasMore: false });
      if (list === "sub") return Response.json({ list: [{ id: "801", type: "photo" }], hasMore: false });
      if (list === "solo") return Response.json({ list: [{ id: 901, type: "photo" }], hasMore: false });
      return Response.json({ list: [], hasMore: false });
    }) as typeof fetch;
    const walked = await walkVault({
      creatorId: "3zk7kbr",
      state: storedState(),
      fetch: fetchImpl,
      now: () => 1_700_000_000_000,
      sql: asSql(db),
      sleep: async () => undefined,
    });
    assert.equal(walked.reason, null);
    assert.ok(walked.items.length > 24);
    assert.equal(seen.some((href) => href.includes("/vault/lists") && href.includes("offset=2")), true);
    assert.equal(seen.some((href) => href.includes("/vault/media") && href.includes("list=88001")), true);
    assert.equal(seen.some((href) => href.includes("/vault/media") && href.includes("list=sub")), true);
    assert.equal(seen.some((href) => href.includes("/vault/media") && href.includes("list=solo")), true);
    assert.equal(lines.some((line) => line.includes("itemClaves=") && line.includes("photos") && line.includes("videos")), true);
    const actor = { userId: "dueña", role: "owner" as const, perms: ["vault"] };
    const opened = await queryVaultForActor(asSql(db), actor, {
      creatorId: "3zk7kbr",
      remember: false,
      query: { ...emptyVaultQuery(), folderId: "88001", scope: "carpeta" },
    });
    const folder = opened.payload.lists.find((list) => list.id === "88001");
    assert.equal(folder?.photos, 7);
    assert.equal(folder?.videos, 1);
    assert.equal(folder?.gifs, 2);
    assert.notEqual(vaultFolderLabel({
      photos: folder?.photos ?? null,
      videos: folder?.videos ?? null,
      gifs: folder?.gifs ?? null,
      audios: folder?.audios ?? null,
      hasMedia: folder?.hasMedia ?? null,
    }, { photos: 0, videos: 0, gifs: 0 }), "Sin datos");
    assert.deepEqual(opened.payload.items.map((item) => item.id).sort(), ["701", "702"]);
    const sub = await queryVaultForActor(asSql(db), actor, {
      creatorId: "3zk7kbr",
      remember: false,
      query: { ...emptyVaultQuery(), folderId: "sub", scope: "carpeta" },
    });
    assert.deepEqual(sub.payload.items.map((item) => item.id), ["801"]);
    assert.equal(sub.payload.lists.find((list) => list.id === "sub")?.photos, 3);
  } finally {
    console.info = previous;
    clearSignRulesCache();
    clearVaultWalkCache();
    await db.close();
  }
});

function asSql(db: PGlite): ReadSql {
  return {
    async query<T>(text: string, params?: unknown[]): Promise<T[]> {
      const result = await db.query<T>(text, params);
      return result.rows;
    },
  };
}

function storedState(): StorageStateFile {
  return {
    cookies: [
      { name: "auth_id", value: "42", domain: ".onlyfans.com", path: "/", expires: -1, httpOnly: true, secure: true, sameSite: "Lax" },
      { name: "sess", value: "ok", domain: ".onlyfans.com", path: "/", expires: -1, httpOnly: true, secure: true, sameSite: "Lax" },
    ],
    origins: [{ origin: "https://onlyfans.com", localStorage: [{ name: "bcTokenSha", value: "huella" }] }],
  };
}
