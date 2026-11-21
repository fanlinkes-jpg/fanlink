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
import { folderColumnView, vaultFolderLabel } from "../../../src/lib/vault-folder-label.ts";
import { emptyVaultQuery } from "../sync/vault-filter.ts";
import { queryVaultForActor } from "../sync/vault-query.ts";
import { clearVaultWalkCache, walkVault } from "../sync/vault-walk.ts";
import { VAULT_LISTS_FIXTURE, VAULT_MEDIA_ALL_FIXTURE, VAULT_MEDIA_FOLDER_FIXTURE } from "./fixtures/vault-of-shape.ts";

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
      const folder = url.searchParams.get("list_id");
      const offset = Number(url.searchParams.get("offset") ?? "0");
      if (folder === "cuarteto") return Response.json({ list: [{ id: 30, type: "video", duration: 9 }, { id: 31, type: "photo" }], hasMore: false });
      if (folder === "ducha") return Response.json({ list: [{ id: 40, type: "video", duration: 3 }], hasMore: false });
      if (!folder && (!list || list === "all")) {
        if (offset === 0) return Response.json({ list: [{ id: 1, type: "photo" }], hasMore: true });
        return Response.json({ list: [{ id: 2, type: "video", duration: 4 }], hasMore: false });
      }
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
    assert.equal(seen.some((href) => href.includes("list_id=cuarteto")), true);
    assert.equal(seen.some((href) => href.includes("list_id=ducha")), true);
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
      const folder = url.searchParams.get("list_id");
      const offset = Number(url.searchParams.get("offset") ?? "0");
      if (folder === "ducha") return Response.json({ list: [{ id: 40, type: "video", duration: 3 }], hasMore: false });
      if (!folder && (!list || list === "all")) {
        if (offset === 0) return Response.json({ list: Array.from({ length: 24 }, (_, index) => ({ id: index + 1, type: "photo" })), hasMore: true });
        return Response.json({ list: Array.from({ length: 6 }, (_, index) => ({ id: 100 + index, type: "photo" })), hasMore: false });
      }
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
    assert.equal(seen.some((href) => href.includes("list_id=ducha")), true);
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

test("un 400 de list_id reintenta una vez con list", async () => {
  clearSignRulesCache();
  const seen: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const href = String(input);
    seen.push(href);
    if (href.includes("dynamic-rules")) return Response.json(RULES);
    const url = new URL(href);
    if (url.searchParams.get("list_id") === "333") return new Response("{}", { status: 400 });
    if (url.searchParams.get("list") === "333") return Response.json(VAULT_MEDIA_FOLDER_FIXTURE);
    return Response.json({ list: [], hasMore: false });
  }) as typeof fetch;
  try {
    const folder = await fetchSignedVault(storedState(), { fetch: fetchImpl, now: () => 1_700_000_000_000 }, "333", 0, { includeLists: false });
    assert.equal(seen.filter((href) => href.includes("list_id=333")).length, 1);
    assert.equal(seen.filter((href) => href.includes("list=333") && !href.includes("list_id=333")).length, 1);
    const saved = folder.payloads[0] as { list?: Array<{ id?: number }> };
    assert.equal(saved.list?.[0]?.id, 9001);
  } finally {
    clearSignRulesCache();
  }
});

test("list=all no lleva type ni field y una carpeta sale con list_id", async () => {
  clearSignRulesCache();
  const seen: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const href = String(input);
    seen.push(href);
    if (href.includes("dynamic-rules")) return Response.json(RULES);
    const url = new URL(href);
    if (url.pathname.endsWith("/vault/lists")) return Response.json(VAULT_LISTS_FIXTURE);
    if (url.searchParams.get("list") === "all") return Response.json(VAULT_MEDIA_ALL_FIXTURE);
    if (url.searchParams.get("list") === "333") return Response.json({ list: [], hasMore: false });
    if (url.searchParams.get("list_id") === "333") return Response.json(VAULT_MEDIA_FOLDER_FIXTURE);
    return Response.json({ list: [], hasMore: false });
  }) as typeof fetch;
  try {
    const all = await fetchSignedVault(storedState(), { fetch: fetchImpl, now: () => 1_700_000_000_000 }, "all", 0, { includeLists: false });
    const allUrl = seen.find((href) => href.includes("/vault/media"));
    assert.ok(allUrl);
    assert.match(allUrl, /list=all/);
    assert.equal(allUrl.includes("type="), false);
    assert.equal(allUrl.includes("field="), false);
    assert.equal(allUrl.includes("list_id="), false);
    assert.equal(all.status, 200);
    const folder = await fetchSignedVault(storedState(), { fetch: fetchImpl, now: () => 1_700_000_000_000 }, "333", 0, { includeLists: false });
    assert.equal(seen.some((href) => href.includes("list=333")), false);
    assert.equal(seen.some((href) => href.includes("list_id=333")), true);
    const saved = folder.payloads[0] as { list?: Array<{ id?: number }> };
    assert.equal(saved.list?.[0]?.id, 9001);
    assert.equal(saved.list?.length, 1);
  } finally {
    clearSignRulesCache();
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

test("una carpeta custom guarda photos y videos y al abrirla solo salen sus medios", async () => {
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
      const folder = url.searchParams.get("list_id");
      const offset = Number(url.searchParams.get("offset") ?? "0");
      if (!folder && (!list || list === "all")) {
        if (offset !== 0) return Response.json({ list: [{ id: 600, type: "video", duration: 2 }, { id: 601, type: "photo" }], hasMore: false });
        return Response.json({
          list: [
            ...Array.from({ length: 23 }, (_, index) => ({ id: index + 1, type: "photo" })),
            { id: 500, type: "photo", listStates: [{ id: "otra", type: "custom", name: "Custom Num" }] },
          ],
          hasMore: true,
        });
      }
      if (folder === "88001") return Response.json({ list: [{ id: 701, type: "photo" }, { id: "702", type: "video", duration: 4 }], hasMore: false });
      if (folder === "sub") return Response.json({ list: [{ id: "801", type: "photo" }], hasMore: false });
      if (folder === "solo") return Response.json({ list: [{ id: 901, type: "photo" }], hasMore: false });
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
    assert.equal(seen.some((href) => href.includes("/vault/media") && href.includes("list_id=88001")), true);
    assert.equal(seen.some((href) => href.includes("/vault/media") && href.includes("list_id=sub")), true);
    assert.equal(seen.some((href) => href.includes("/vault/media") && href.includes("list_id=solo")), true);
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

test("dos creadoras no comparten los conteos ni las portadas de sus carpetas", async () => {
  clearSignRulesCache();
  clearVaultWalkCache();
  const db = new PGlite();
  const shapes: Record<string, ReturnType<typeof creatorLists>> = {
    "crea-a": creatorLists([400, 80, 3, 1], [
      { id: 501, name: "Carpeta norte", counts: [9, 2, 0, 0], covers: [701, 702] },
      { id: 502, name: "Carpeta sur", counts: [1, 6, 1, 0], covers: [703] },
    ]),
    "crea-b": creatorLists([20, 4, 0, 0], [
      { id: 601, name: "Carpeta este", counts: [5, 1, 0, 2], covers: [801] },
      { id: 602, name: "Carpeta oeste", counts: [0, 3, 0, 0], covers: [802] },
    ]),
  };
  let creator = "crea-a";
  const seen: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const href = String(input);
    seen.push(href);
    if (href.includes("dynamic-rules")) return Response.json(RULES);
    const url = new URL(href);
    const shape = shapes[creator]!;
    if (url.pathname.endsWith("/vault/lists")) return Response.json(shape);
    const folder = url.searchParams.get("list_id");
    if (folder) {
      const row = shape.list.find((item) => String(item.id) === folder);
      const cover = row && "medias" in row ? row.medias[0] : null;
      return Response.json({
        list: cover ? [{ id: cover.id, type: cover.type, listStates: [{ id: Number(folder), type: "custom", name: row?.name, hasMedia: true, canAddMedia: true }] }] : [],
        hasMore: false,
      });
    }
    return Response.json({
      list: [{ id: 1, type: "photo", listStates: shape.list.filter((item) => item.type === "custom").map((item) => ({ id: item.id, type: "custom", name: item.name, hasMedia: false, canAddMedia: true })) }],
      hasMore: false,
    });
  }) as typeof fetch;
  try {
    for (const file of ["0037_vault_mirror.sql", "0038_vault_fan_filter.sql", "0040_vault_full_tags.sql", "0042_vault_paid_with.sql", "0044_vault_thumb_page.sql", "0050_vault_list_counts.sql", "0051_vault_list_media.sql", "0052_vault_clip.sql", "0053_vault_list_covers.sql"]) {
      await db.exec(await readFile(path.join(root, "migrations", file), "utf8"));
    }
    for (const id of ["crea-a", "crea-b"]) {
      creator = id;
      await walkVault({
        creatorId: id,
        state: storedState(),
        fetch: fetchImpl,
        now: () => 1_700_000_000_000,
        sql: asSql(db),
        sleep: async () => undefined,
      });
    }
    const actor = { userId: "dueña", role: "owner" as const, perms: ["vault"] };
    const expected: Record<string, Array<{ id: string; label: string; covers: string[] }>> = {
      "crea-a": [
        { id: "501", label: "9 fotos · 2 vídeos", covers: ["701", "702"] },
        { id: "502", label: "1 foto · 6 vídeos · 1 GIF", covers: ["703"] },
      ],
      "crea-b": [
        { id: "601", label: "5 fotos · 1 vídeo · 2 audios", covers: ["801"] },
        { id: "602", label: "0 fotos · 3 vídeos", covers: ["802"] },
      ],
    };
    for (const id of ["crea-a", "crea-b"]) {
      const view = await queryVaultForActor(asSql(db), actor, { creatorId: id, remember: false, query: emptyVaultQuery() });
      assert.equal(view.payload.lists.some((list) => list.id === (id === "crea-a" ? "601" : "501")), false);
      for (const row of expected[id] ?? []) {
        const folder = view.payload.lists.find((list) => list.id === row.id);
        const column = folderColumnView({
          counts: {
            photos: folder?.photos ?? null,
            videos: folder?.videos ?? null,
            gifs: folder?.gifs ?? null,
            audios: folder?.audios ?? null,
            hasMedia: folder?.hasMedia ?? null,
          },
          covers: folder?.covers ?? [],
          ownItems: view.payload.items.map((item) => ({ id: item.id, kind: item.kind })),
        });
        assert.equal(column.label, row.label);
        assert.deepEqual(column.coverIds, row.covers);
      }
    }
    const opened = await queryVaultForActor(asSql(db), actor, {
      creatorId: "crea-a",
      remember: false,
      query: { ...emptyVaultQuery(), folderId: "501", scope: "carpeta" },
    });
    assert.deepEqual(opened.payload.items.map((item) => item.id), ["701"]);
    assert.equal(seen.some((href) => href.includes("list=501") || href.includes("list=601")), false);
    assert.equal(seen.some((href) => href.includes("list_id=501")), true);
    assert.equal(seen.some((href) => href.includes("list_id=601")), true);
  } finally {
    clearSignRulesCache();
    clearVaultWalkCache();
    await db.close();
  }
});

function creatorLists(
  all: [number, number, number, number],
  folders: Array<{ id: number; name: string; counts: [number, number, number, number]; covers: number[] }>,
) {
  return {
    list: folders.map((folder) => ({
      id: folder.id,
      type: "custom" as const,
      name: folder.name,
      hasMedia: true,
      canUpdate: true,
      canDelete: true,
      photosCount: folder.counts[0],
      videosCount: folder.counts[1],
      gifsCount: folder.counts[2],
      audiosCount: folder.counts[3],
      medias: folder.covers.map((id, index) => ({
        id,
        type: index === 0 && folder.counts[2] > 0 ? "gif" : index === 0 && folder.counts[1] > 0 && folder.counts[0] === 0 ? "video" : "photo",
        url: "https://cdn2.onlyfans.com/files/cover.jpg",
      })),
      echo: { photosCount: all[0], videosCount: all[1], gifsCount: all[2], audiosCount: all[3] },
    })),
    all: {
      photosCount: all[0],
      videosCount: all[1],
      gifsCount: all[2],
      audiosCount: all[3],
      medias: [{ type: "photo", url: "https://cdn2.onlyfans.com/files/all.jpg" }],
    },
    hasMore: false,
    canCreateVaultLists: true,
    order: "asc",
    sort: "custom",
  };
}

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
