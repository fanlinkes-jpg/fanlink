import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { clearAccountChatPace } from "../sync/api-list-pace.ts";
import { accountPause, clearAccountPauses } from "../sync/backoff.ts";
import { fetchSignedVault, sessionForApi, signedHeaders, vaultListMediaPath } from "../sync/of-chat-api.ts";
import { clearSignRulesCache, parseSignRules } from "../sync/of-sign.ts";
import type { StorageStateFile } from "../sessions/storage-state.ts";
import type { Account } from "../types.ts";
import type { ReadSql } from "../sync/store.ts";
import { folderColumnView, VAULT_FOLDER_READ_ERROR, vaultFolderLabel } from "../../../src/lib/vault-folder-label.ts";
import { emptyVaultQuery } from "../sync/vault-filter.ts";
import { readChatVaultView } from "../sync/vault-read.ts";
import { queryVaultForActor } from "../sync/vault-query.ts";
import { vaultFolderMark } from "../sync/vault-model.ts";
import { clearVaultWalkCache, VAULT_WALK_CAP, walkVault } from "../sync/vault-walk.ts";
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
      if (isVaultListsIndex(href)) {
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
      const folder = url.searchParams.get("list_id") || (url.searchParams.get("list") !== "all" ? url.searchParams.get("list") : null);
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
    assert.equal(seen.some((href) => href.includes("list=cuarteto")), true);
    assert.equal(seen.some((href) => href.includes("list=ducha")), true);
    assert.equal(seen.some((href) => isVaultListsIndex(href) && href.includes("limit=50")), true);
    assert.equal(seen.some((href) => href.includes("/vault/media") && href.includes("limit=40") && href.includes("field=recent") && href.includes("sort=desc") && href.includes("list=all") && !href.includes("list_id=")), true);
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
      if (isVaultListsIndex(href)) {
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
      const folder = url.searchParams.get("list_id") || (url.searchParams.get("list") !== "all" ? url.searchParams.get("list") : null);
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
    assert.equal(seen.some((href) => isVaultListsIndex(href) && href.includes("offset=5")), true);
    assert.equal(seen.some((href) => href.includes("/vault/media") && href.includes("offset=24") && href.includes("list=all")), true);
    assert.equal(seen.some((href) => href.includes("list=ducha")), true);
    assert.equal(lines.some((line) => line.includes("pagina ruta=/api2/v2/vault/media") && line.includes("offset=0") && line.includes("n=24") && line.includes("hasMore=si") && line.includes("list=todos")), true);
    assert.equal(lines.some((line) => line.includes("respuesta ruta=lists") && line.includes("itemClaves=") && line.includes("photosCount")), true);
    assert.equal(lines.some((line) => line.includes("fotos=4") && line.includes("videos=2") && line.includes("photosCount") && !line.includes("nombre=")), true);
    assert.equal(lines.some((line) => line.includes("nombre=") || line.includes("id=ducha")), false);
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
      if (isVaultListsIndex(href)) {
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

test("list_id de una carpeta no guarda la bóveda entera", async () => {
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
    for (const file of ["0037_vault_mirror.sql", "0038_vault_fan_filter.sql", "0040_vault_full_tags.sql", "0042_vault_paid_with.sql", "0044_vault_thumb_page.sql", "0050_vault_list_counts.sql", "0051_vault_list_media.sql", "0054_vault_list_members.sql"]) {
      await db.exec(await readFile(path.join(root, "migrations", file), "utf8"));
    }
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const href = String(input);
      seen.push(href);
      if (href.includes("dynamic-rules")) return Response.json(RULES);
      const url = new URL(href);
      if (url.pathname.endsWith("/vault/lists")) {
        return Response.json({
          list: [
            { id: 88001, type: "custom", name: "Carpeta corta", photosCount: 0, videosCount: 2, gifsCount: 0, audiosCount: 0, hasMedia: true },
            { id: 88002, type: "custom", name: "Carpeta ajena", photosCount: 0, videosCount: 2, gifsCount: 0, audiosCount: 0, hasMedia: true },
          ],
          all: { photosCount: 40, videosCount: 10, gifsCount: 0, audiosCount: 0 },
          hasMore: false,
        });
      }
      if (url.searchParams.get("list") === "all") {
        return Response.json({ list: [{ id: 1, type: "photo" }], hasMore: false });
      }
      if ((url.searchParams.get("list_id") || url.searchParams.get("list")) === "88001") {
        return Response.json({
          list: [
            { id: 701, type: "video", duration: 4 },
            { id: 702, type: "video", duration: 5 },
          ],
          hasMore: false,
        });
      }
      if ((url.searchParams.get("list_id") || url.searchParams.get("list")) === "88002") {
        return Response.json({
          list: Array.from({ length: 40 }, (_, index) => ({ id: 1000 + index, type: "photo" })),
          hasMore: true,
        });
      }
      if (url.searchParams.get("list") === "88002" || url.searchParams.get("list") === "88001") {
        return Response.json({
          list: Array.from({ length: 40 }, (_, index) => ({ id: 2000 + index, type: "photo" })),
          hasMore: true,
        });
      }
      return Response.json({ list: [], hasMore: false });
    }) as typeof fetch;
    await asSql(db).query(
      "insert into of_vault_list_item (creator_id, list_key, item_key) values ($1, $2, $3)",
      ["3zk7kbr", "88001", "viejo"],
    );
    const walked = await walkVault({
      creatorId: "3zk7kbr",
      state: storedState(),
      fetch: fetchImpl,
      now: () => 1_700_000_000_000,
      sql: asSql(db),
      sleep: async () => undefined,
    });
    assert.equal(walked.reason, null);
    assert.equal(seen.some((href) => href.includes("list=88001")), true);
    assert.equal(seen.some((href) => href.includes("list=88002")), true);
    assert.equal(seen.some((href) => href.includes("list=88002") && href.includes("field=recent") && href.includes("offset=40")), false);
    assert.equal(seen.some((href) => href.includes("list_id=")), false);
    assert.equal(lines.some((line) => line.includes("sospechosa") && line.includes("param=list") && !line.includes("param=list_id") && !line.includes("88002")), true);
    assert.equal(lines.some((line) => line.includes("88001") || line.includes("88002") || line.includes("Carpeta")), false);
    const actor = { userId: "dueña", role: "owner" as const, perms: ["vault"] };
    const good = await queryVaultForActor(asSql(db), actor, {
      creatorId: "3zk7kbr",
      remember: false,
      query: { ...emptyVaultQuery(), folderId: "88001", scope: "carpeta" },
    });
    assert.deepEqual(good.payload.items.map((item) => item.id).sort(), ["701", "702"]);
    const members = await asSql(db).query<{ item_key: string }>(
      "select item_key from of_vault_list_item where creator_id = $1 and list_key = $2",
      ["3zk7kbr", "88001"],
    );
    assert.deepEqual(members.map((row) => row.item_key).sort(), ["701", "702"]);
    const bad = await queryVaultForActor(asSql(db), actor, {
      creatorId: "3zk7kbr",
      remember: false,
      query: { ...emptyVaultQuery(), folderId: "88002", scope: "carpeta" },
    });
    assert.deepEqual(bad.payload.items, []);
  } finally {
    console.info = previous;
    clearSignRulesCache();
    clearVaultWalkCache();
    await db.close();
  }
});

test("una carpeta sale con list_id mientras Todos sigue en la primera página", async () => {
  clearSignRulesCache();
  clearVaultWalkCache();
  const db = new PGlite();
  const order: string[] = [];
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const href = String(input);
    if (href.includes("dynamic-rules")) return Response.json(RULES);
    const url = new URL(href);
    if (url.pathname.endsWith("/vault/lists")) return Response.json({ list: [], hasMore: false });
    if ((url.searchParams.get("list_id") || url.searchParams.get("list")) === "nocturno") {
      order.push("folder");
      return Response.json({ list: [{ id: 501, type: "video", duration: 3 }], hasMore: false });
    }
    if (url.searchParams.get("list") === "all") {
      const offset = url.searchParams.get("offset") ?? "0";
      order.push(`all:${offset}`);
      if (offset === "0") await gate;
      const full = offset === "0";
      return Response.json({
        list: full ? Array.from({ length: 40 }, (_, index) => ({ id: index + 1, type: "photo" })) : [{ id: 99, type: "photo" }],
        hasMore: full,
      });
    }
    return Response.json({ list: [], hasMore: false });
  }) as typeof fetch;
  const deps = {
    creatorId: "3zk7kbr",
    state: storedState(),
    fetch: fetchImpl,
    now: () => 1_700_000_000_000,
    sql: asSql(db),
    accountId: "acc-prio",
    sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  };
  try {
    for (const file of ["0037_vault_mirror.sql", "0050_vault_list_counts.sql"]) {
      await db.exec(await readFile(path.join(root, "migrations", file), "utf8"));
    }
    const all = walkVault({ ...deps, listId: "all" });
    const started = Date.now() + 2_000;
    while (!order.includes("all:0") && Date.now() < started) await new Promise((resolve) => setTimeout(resolve, 10));
    const folder = walkVault({ ...deps, listId: "nocturno", singlePage: true });
    release();
    const opened = await folder;
    await all;
    assert.equal(opened.items[0]?.id, "501");
    assert.equal(order.includes("folder"), true);
    assert.ok(order.indexOf("folder") < order.indexOf("all:40"), order.join(" "));
  } finally {
    release();
    clearSignRulesCache();
    clearVaultWalkCache();
    await db.close();
  }
});

test("la carpeta pide list y field=recent, sin list_id", async () => {
  clearSignRulesCache();
  const seen: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const href = String(input);
    seen.push(href);
    if (href.includes("dynamic-rules")) return Response.json(RULES);
    const url = new URL(href);
    if (url.searchParams.get("list") === "333") return Response.json(VAULT_MEDIA_FOLDER_FIXTURE);
    return Response.json({ list: [], hasMore: false });
  }) as typeof fetch;
  try {
    const folder = await fetchSignedVault(storedState(), { fetch: fetchImpl, now: () => 1_700_000_000_000 }, "333", 0, { includeLists: false });
    assert.equal(seen.filter((href) => href.includes("list=333") && href.includes("field=recent")).length, 1);
    assert.equal(seen.some((href) => href.includes("list_id=")), false);
    const saved = folder.payloads[0] as { list?: Array<{ id?: number }> };
    assert.equal(saved.list?.[0]?.id, 9001);
  } finally {
    clearSignRulesCache();
  }
});

test("list=all lleva field=recent y la carpeta usa list", async () => {
  clearSignRulesCache();
  const seen: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const href = String(input);
    seen.push(href);
    if (href.includes("dynamic-rules")) return Response.json(RULES);
    const url = new URL(href);
    if (url.pathname.endsWith("/vault/lists")) return Response.json(VAULT_LISTS_FIXTURE);
    if (url.searchParams.get("list") === "all") return Response.json(VAULT_MEDIA_ALL_FIXTURE);
    if (url.searchParams.get("list") === "333") return Response.json(VAULT_MEDIA_FOLDER_FIXTURE);
    return Response.json({ list: [], hasMore: false });
  }) as typeof fetch;
  try {
    const all = await fetchSignedVault(storedState(), { fetch: fetchImpl, now: () => 1_700_000_000_000 }, "all", 0, { includeLists: false });
    const allUrl = seen.find((href) => href.includes("/vault/media"));
    assert.ok(allUrl);
    assert.match(allUrl, /list=all/);
    assert.equal(allUrl.includes("type="), false);
    assert.match(allUrl, /field=recent/);
    assert.equal(allUrl.includes("list_id="), false);
    assert.equal(all.status, 200);
    const folder = await fetchSignedVault(storedState(), { fetch: fetchImpl, now: () => 1_700_000_000_000 }, "333", 0, { includeLists: false });
    assert.equal(seen.some((href) => href.includes("list=333") && href.includes("field=recent")), true);
    assert.equal(seen.some((href) => href.includes("list_id=")), false);
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
      if (isVaultListsIndex(href)) {
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
      const folder = url.searchParams.get("list_id") || (url.searchParams.get("list") !== "all" ? url.searchParams.get("list") : null);
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
    assert.equal(seen.some((href) => isVaultListsIndex(href) && href.includes("offset=2")), true);
    assert.equal(seen.some((href) => href.includes("/vault/lists/88001/media") && href.includes("list=88001")), true);
    assert.equal(seen.some((href) => href.includes("/vault/lists/sub/media") && href.includes("list=sub")), true);
    assert.equal(seen.some((href) => href.includes("/vault/lists/solo/media") && href.includes("list=solo")), true);
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
    const folder = url.searchParams.get("list_id") || (url.searchParams.get("list") !== "all" ? url.searchParams.get("list") : null);
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
    assert.equal(seen.some((href) => href.includes("field=recent") && href.includes("list=501")), true);
    assert.equal(seen.some((href) => href.includes("list_id=")), false);
    assert.equal(seen.some((href) => href.includes("list=501")), true);
    assert.equal(seen.some((href) => href.includes("list=601")), true);
  } finally {
    clearSignRulesCache();
    clearVaultWalkCache();
    await db.close();
  }
});

test("list_id ignorado no deja la carpeta en cero si listStates marca sus medios", async () => {
  clearSignRulesCache();
  clearVaultWalkCache();
  const db = new PGlite();
  const lines: string[] = [];
  const previous = console.info;
  console.info = (line?: unknown) => {
    lines.push(String(line));
  };
  const page = [
    { id: 11, type: "video", duration: 4, listStates: [{ id: 2901, type: "custom", hasMedia: true, canAddMedia: true }, { id: 2902, type: "custom", hasMedia: false, canAddMedia: true }] },
    { id: 12, type: "video", duration: 5, listStates: [{ id: 2901, type: "custom", hasMedia: 1, canAddMedia: true }, { id: 2902, type: "custom", hasMedia: false, canAddMedia: true }] },
    ...Array.from({ length: 38 }, (_, index) => ({
      id: 100 + index,
      type: "photo",
      listStates: [{ id: 2901, type: "custom", hasMedia: false, canAddMedia: true }, { id: 2902, type: "custom", hasMedia: false, canAddMedia: true }],
    })),
  ];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const href = String(input);
    if (href.includes("dynamic-rules")) return Response.json(RULES);
    const url = new URL(href);
    if (url.pathname.endsWith("/vault/lists")) {
      return Response.json({
        list: [{ id: 2901, type: "custom", name: "B/B/B/G EL CUARTETO", photosCount: 0, videosCount: 2, gifsCount: 0, audiosCount: 0, hasMedia: true }],
        all: { photosCount: 615, videosCount: 130, gifsCount: 2, audiosCount: 2 },
        hasMore: false,
      });
    }
    if (url.searchParams.get("list") === "2901" || url.searchParams.get("list") === "all") {
      return Response.json({ list: page, hasMore: false });
    }
    return Response.json({ list: [], hasMore: false });
  }) as typeof fetch;
  try {
    for (const file of ["0037_vault_mirror.sql", "0038_vault_fan_filter.sql", "0050_vault_list_counts.sql", "0053_vault_list_covers.sql", "0054_vault_list_members.sql"]) {
      await db.exec(await readFile(path.join(root, "migrations", file), "utf8"));
    }
    await asSql(db).query(
      "insert into of_vault_list (creator_id, list_key, name, synced_at, cover_ids) values ($1, $2, $3, $4, $5::jsonb)",
      ["3zk7kbr", "2901", "previa", "2026-01-01T00:00:00.000Z", JSON.stringify([{ id: "todos-1", kind: "foto" }])],
    );
    const walked = await walkVault({
      creatorId: "3zk7kbr",
      state: storedState(),
      fetch: fetchImpl,
      now: () => 1_700_000_000_000,
      sql: asSql(db),
      sleep: async () => undefined,
    });
    assert.equal(walked.reason, null);
    const actor = { userId: "dueña", role: "owner" as const, perms: ["vault"] };
    const opened = await queryVaultForActor(asSql(db), actor, {
      creatorId: "3zk7kbr",
      remember: false,
      query: { ...emptyVaultQuery(), folderId: "2901", scope: "carpeta" },
    });
    assert.deepEqual(opened.payload.items.map((item) => item.id).sort(), ["11", "12"]);
    const covers = await asSql(db).query<{ cover_ids: unknown }>(
      "select cover_ids from of_vault_list where creator_id = $1 and list_key = $2",
      ["3zk7kbr", "2901"],
    );
    assert.equal(JSON.stringify(covers[0]?.cover_ids ?? []).includes("todos-1"), false);
    assert.equal(lines.some((line) => line.includes("sospechosa") && line.includes("param=list") && !line.includes("param=list_id") && line.includes("respaldo=si") && line.includes("enLista=2")), true);
    assert.equal(lines.some((line) => line.includes("2901") || line.includes("CUARTETO")), false);
  } finally {
    console.info = previous;
    clearSignRulesCache();
    clearVaultWalkCache();
    await db.close();
  }
});

test("un 400 de list_id no guarda el list hinchado", async () => {
  clearSignRulesCache();
  clearVaultWalkCache();
  const db = new PGlite();
  const seen: string[] = [];
  const lines: string[] = [];
  const previous = console.info;
  console.info = (line?: unknown) => {
    lines.push(String(line));
  };
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const href = String(input);
    seen.push(href);
    if (href.includes("dynamic-rules")) return Response.json(RULES);
    const url = new URL(href);
    if (url.pathname.endsWith("/vault/lists")) {
      return Response.json({
        list: [{ id: 77001, type: "custom", name: "Carpeta", photosCount: 0, videosCount: 2, gifsCount: 0, audiosCount: 0, hasMedia: true }],
        hasMore: false,
      });
    }
    if (url.searchParams.get("list") === "all") return Response.json({ list: [{ id: 1, type: "photo" }], hasMore: false });
    if (url.searchParams.get("list") === "77001") {
      return Response.json({ list: Array.from({ length: 40 }, (_, index) => ({ id: 3000 + index, type: "photo" })), hasMore: true });
    }
    return Response.json({ list: [], hasMore: false });
  }) as typeof fetch;
  try {
    for (const file of ["0037_vault_mirror.sql", "0050_vault_list_counts.sql", "0054_vault_list_members.sql"]) {
      await db.exec(await readFile(path.join(root, "migrations", file), "utf8"));
    }
    await walkVault({
      creatorId: "3zk7kbr",
      state: storedState(),
      fetch: fetchImpl,
      now: () => 1_700_000_000_000,
      sql: asSql(db),
      sleep: async () => undefined,
    });
    assert.equal(seen.filter((href) => href.includes("list=77001") && href.includes("field=recent")).length, 1);
    assert.equal(seen.some((href) => href.includes("list_id=")), false);
    assert.equal(lines.some((line) => line.includes("sospechosa") && line.includes("param=list") && !line.includes("param=list_id")), true);
    assert.equal(lines.some((line) => line.includes("77001") || line.includes("nombre=")), false);
    const members = await asSql(db).query<{ item_key: string }>(
      "select item_key from of_vault_list_item where creator_id = $1 and list_key = $2",
      ["3zk7kbr", "77001"],
    );
    assert.deepEqual(members, []);
  } finally {
    console.info = previous;
    clearSignRulesCache();
    clearVaultWalkCache();
    await db.close();
  }
});

test("una carpeta de más de 40 medios olvida los miembros viejos", async () => {
  clearSignRulesCache();
  clearVaultWalkCache();
  const db = new PGlite();
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const href = String(input);
    if (href.includes("dynamic-rules")) return Response.json(RULES);
    const url = new URL(href);
    if (url.pathname.endsWith("/vault/lists")) return Response.json({ list: [], hasMore: false });
    if (url.searchParams.get("list") !== "88041") return Response.json({ list: [], hasMore: false });
    const offset = Number(url.searchParams.get("offset") ?? "0");
    if (offset === 0) {
      return Response.json({
        list: Array.from({ length: 40 }, (_, index) => ({ id: index + 1, type: "video", duration: 2 })),
        hasMore: true,
      });
    }
    return Response.json({ list: [{ id: 41, type: "video", duration: 2 }], hasMore: false });
  }) as typeof fetch;
  try {
    for (const file of ["0037_vault_mirror.sql", "0050_vault_list_counts.sql", "0054_vault_list_members.sql"]) {
      await db.exec(await readFile(path.join(root, "migrations", file), "utf8"));
    }
    await asSql(db).query(
      "insert into of_vault_list (creator_id, list_key, name, synced_at, photos_count, videos_count, gifs_count, audios_count) values ($1, $2, $3, $4, $5, $6, $7, $8)",
      ["3zk7kbr", "88041", "grande", "2026-01-01T00:00:00.000Z", 0, 41, 0, 0],
    );
    await asSql(db).query(
      "insert into of_vault_list_item (creator_id, list_key, item_key) values ($1, $2, $3)",
      ["3zk7kbr", "88041", "viejo"],
    );
    const opened = await walkVault({
      creatorId: "3zk7kbr",
      listId: "88041",
      singlePage: true,
      state: storedState(),
      fetch: fetchImpl,
      now: () => 1_700_000_000_000,
      sql: asSql(db),
      sleep: async () => undefined,
    });
    assert.equal(opened.items.length, 40);
    await opened.membersSettled;
    const members = await asSql(db).query<{ item_key: string }>(
      "select item_key from of_vault_list_item where creator_id = $1 and list_key = $2 order by item_key",
      ["3zk7kbr", "88041"],
    );
    assert.equal(members.some((row) => row.item_key === "viejo"), false);
    assert.equal(members.length, 41);
  } finally {
    clearSignRulesCache();
    clearVaultWalkCache();
    await db.close();
  }
});

test("una carpeta vacía con field=recent usa el espejo de Todos", async () => {
  clearSignRulesCache();
  clearVaultWalkCache();
  const db = new PGlite();
  const lines: string[] = [];
  const previous = console.info;
  console.info = (line?: unknown) => {
    lines.push(String(line));
  };
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const href = String(input);
    if (href.includes("dynamic-rules")) return Response.json(RULES);
    const url = new URL(href);
    if (url.pathname.endsWith("/vault/lists")) {
      return Response.json({
        list: [{ id: 2904, type: "custom", name: "Carpeta", photosCount: 0, videosCount: 2, gifsCount: 0, audiosCount: 0, hasMedia: true }],
        hasMore: false,
      });
    }
    const list = url.searchParams.get("list");
    const offset = Number(url.searchParams.get("offset") ?? "0");
    if (list === "2904") return Response.json({ list: [], hasMore: false });
    if (list === "all" && offset === 0) {
      return Response.json({
        list: Array.from({ length: 40 }, (_, index) => ({
          id: index + 1,
          type: "photo",
          listStates: [{ id: 2904, hasMedia: false, canAddMedia: true }],
        })),
        hasMore: true,
      });
    }
    return Response.json({
      list: [
        { id: 41, type: "video", duration: 4, listStates: [{ id: 2904, hasMedia: true, canAddMedia: true }] },
        { id: 42, type: "video", duration: 5, listStates: [{ id: 2904, hasMedia: true, canAddMedia: true }] },
      ],
      hasMore: false,
    });
  }) as typeof fetch;
  try {
    for (const file of ["0037_vault_mirror.sql", "0038_vault_fan_filter.sql", "0050_vault_list_counts.sql", "0054_vault_list_members.sql"]) {
      await db.exec(await readFile(path.join(root, "migrations", file), "utf8"));
    }
    await walkVault({
      creatorId: "3zk7kbr",
      state: storedState(),
      fetch: fetchImpl,
      now: () => 1_700_000_000_000,
      sql: asSql(db),
      sleep: async () => undefined,
    });
    const opened = await queryVaultForActor(asSql(db), { userId: "dueña", role: "owner", perms: ["vault"] }, {
      creatorId: "3zk7kbr",
      remember: false,
      query: { ...emptyVaultQuery(), folderId: "2904", scope: "carpeta" },
    });
    assert.deepEqual(opened.payload.items.map((item) => item.id).sort(), ["41", "42"]);
    assert.equal(lines.some((line) => line.includes("respaldo=si") && line.includes("n=0") && line.includes("param=list")), true);
    assert.equal(lines.some((line) => line.includes("2904")), false);
  } finally {
    console.info = previous;
    clearSignRulesCache();
    clearVaultWalkCache();
    await db.close();
  }
});

test("una carpeta con conteo pide su página aunque el presupuesto se haya acabado", async () => {
  clearSignRulesCache();
  clearVaultWalkCache();
  const db = new PGlite();
  const seen: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const href = String(input);
    seen.push(href);
    if (href.includes("dynamic-rules")) return Response.json(RULES);
    const url = new URL(href);
    if (url.pathname.endsWith("/vault/lists")) {
      return Response.json({
        list: [
          { id: 81001, type: "custom", name: "Una", photosCount: 0, videosCount: 2, hasMedia: true },
          { id: 81002, type: "custom", name: "Otra", photosCount: 4, videosCount: 0, hasMedia: true },
        ],
        hasMore: false,
      });
    }
    const list = url.searchParams.get("list");
    if (list === "81001") return Response.json({ list: [{ id: 1, type: "video", duration: 3 }], hasMore: true });
    if (list === "81002") return Response.json({ list: [{ id: 2, type: "photo" }], hasMore: false });
    return Response.json({ list: [{ id: 9, type: "photo" }], hasMore: false });
  }) as typeof fetch;
  try {
    for (const file of ["0037_vault_mirror.sql", "0038_vault_fan_filter.sql", "0050_vault_list_counts.sql", "0054_vault_list_members.sql"]) {
      await db.exec(await readFile(path.join(root, "migrations", file), "utf8"));
    }
    const walked = await walkVault({
      creatorId: "3zk7kbr",
      budget: 1,
      state: storedState(),
      fetch: fetchImpl,
      now: () => 1_700_000_000_000,
      sql: asSql(db),
      sleep: async () => undefined,
    });
    assert.equal(seen.some((href) => href.includes("list=81001") && href.includes("field=recent")), true);
    assert.equal(seen.some((href) => href.includes("list=81002") && href.includes("field=recent")), true);
    assert.equal(walked.hasMore, true);
    const pending = await queryVaultForActor(asSql(db), { userId: "dueña", role: "owner", perms: ["vault"] }, {
      creatorId: "3zk7kbr",
      remember: false,
      query: { ...emptyVaultQuery(), folderId: "81001", scope: "carpeta" },
    });
    assert.deepEqual(pending.payload.items.map((item) => item.id), ["1"]);
    const next = await queryVaultForActor(asSql(db), { userId: "dueña", role: "owner", perms: ["vault"] }, {
      creatorId: "3zk7kbr",
      remember: false,
      query: { ...emptyVaultQuery(), folderId: "81002", scope: "carpeta" },
    });
    assert.deepEqual(next.payload.items.map((item) => item.id), ["2"]);
  } finally {
    clearSignRulesCache();
    clearVaultWalkCache();
    await db.close();
  }
});

test("una carpeta vacía pagina Todos si el espejo aún no tiene sus medios", async () => {
  clearSignRulesCache();
  clearVaultWalkCache();
  const db = new PGlite();
  const seen: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const href = String(input);
    seen.push(href);
    if (href.includes("dynamic-rules")) return Response.json(RULES);
    const url = new URL(href);
    if (url.pathname.endsWith("/vault/lists")) {
      return Response.json({
        list: [{ id: 2905, type: "custom", name: "Tarde", photosCount: 0, videosCount: 2, hasMedia: true }],
        hasMore: false,
      });
    }
    const list = url.searchParams.get("list");
    const offset = Number(url.searchParams.get("offset") ?? "0");
    if (list === "2905") return Response.json({ list: [], hasMore: false });
    if (offset === 0) {
      return Response.json({
        list: Array.from({ length: 40 }, (_, index) => ({ id: index + 1, type: "photo", listStates: [{ id: 2905, hasMedia: false }] })),
        hasMore: true,
      });
    }
    return Response.json({
      list: [
        { id: 41, type: "video", duration: 4, listStates: [{ id: 2905, hasMedia: true }] },
        { id: 42, type: "video", duration: 6, listStates: [{ id: 2905, hasMedia: true }] },
      ],
      hasMore: false,
    });
  }) as typeof fetch;
  try {
    for (const file of ["0037_vault_mirror.sql", "0050_vault_list_counts.sql", "0054_vault_list_members.sql"]) {
      await db.exec(await readFile(path.join(root, "migrations", file), "utf8"));
    }
    await asSql(db).query(
      "insert into of_vault_list (creator_id, list_key, name, synced_at, photos_count, videos_count, gifs_count, audios_count) values ($1, $2, $3, $4, 0, 2, 0, 0)",
      ["3zk7kbr", "2905", "Tarde", "2026-01-01T00:00:00.000Z"],
    );
    const opened = await walkVault({
      creatorId: "3zk7kbr",
      listId: "2905",
      singlePage: true,
      state: storedState(),
      fetch: fetchImpl,
      now: () => 1_700_000_000_000,
      sql: asSql(db),
      sleep: async () => undefined,
    });
    assert.deepEqual(opened.items.map((item) => item.id).sort(), ["41", "42"]);
    assert.equal(seen.some((href) => href.includes("list=2905")), true);
    assert.equal(seen.some((href) => href.includes("list=all") && href.includes("offset=40")), true);
  } finally {
    clearSignRulesCache();
    clearVaultWalkCache();
    await db.close();
  }
});

test("hasMore siempre true se corta en 40 páginas", async () => {
  clearSignRulesCache();
  clearVaultWalkCache();
  const db = new PGlite();
  const lines: string[] = [];
  const previous = console.info;
  console.info = (line?: unknown) => {
    lines.push(String(line));
  };
  let mediaPages = 0;
  try {
    for (const file of ["0037_vault_mirror.sql", "0038_vault_fan_filter.sql", "0040_vault_full_tags.sql", "0042_vault_paid_with.sql", "0044_vault_thumb_page.sql", "0050_vault_list_counts.sql", "0051_vault_list_media.sql"]) {
      await db.exec(await readFile(path.join(root, "migrations", file), "utf8"));
    }
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const href = String(input);
      if (href.includes("dynamic-rules")) return Response.json(RULES);
      if (isVaultListsIndex(href)) return Response.json({ list: [], hasMore: false });
      const url = new URL(href);
      if (!url.pathname.endsWith("/vault/media")) return Response.json({ list: [], hasMore: false });
      mediaPages += 1;
      const offset = Number(url.searchParams.get("offset") ?? "0");
      return Response.json({ list: [{ id: offset + 1, type: "photo" }], hasMore: true });
    }) as typeof fetch;
    const walked = await walkVault({
      creatorId: "3zk7kbr",
      state: storedState(),
      fetch: fetchImpl,
      now: () => 1_700_000_000_000,
      sql: asSql(db),
      sleep: async () => undefined,
    });
    assert.equal(mediaPages, VAULT_WALK_CAP);
    assert.equal(walked.items.length, VAULT_WALK_CAP);
    assert.equal(walked.hasMore, true);
    assert.equal(lines.some((line) => line.includes("corte tope")), true);
    assert.equal(lines.some((line) => line.includes("paginas=40")), true);
  } finally {
    console.info = previous;
    clearSignRulesCache();
    clearVaultWalkCache();
    await db.close();
  }
});

function isVaultListsIndex(href: string): boolean {
  try {
    return new URL(href).pathname.endsWith("/vault/lists");
  } catch {
    return false;
  }
}

test("una subcarpeta pagina lists/{id}/media y no se queda en paginas=0", async () => {
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
    const now = 1_700_000_000_000;
    const rules = parseSignRules(RULES);
    assert.ok(rules);
    const auth = sessionForApi(storedState(), now);
    assert.equal("cookie" in auth, true);
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const href = String(input);
      seen.push(href);
      if (href.includes("dynamic-rules")) return Response.json(RULES);
      if (isVaultListsIndex(href)) {
        return Response.json({
          list: [{ id: 88002, type: "custom", name: "Sub", photosCount: 43, videosCount: 0, hasMedia: true }],
          hasMore: false,
        });
      }
      const url = new URL(href);
      if (url.pathname.endsWith("/vault/media")) return Response.json({ list: [], hasMore: false });
      if (!url.pathname.endsWith("/vault/lists/88002/media")) return Response.json({ list: [], hasMore: false });
      const offset = Number(url.searchParams.get("offset") ?? "0");
      const path = `${url.pathname}${url.search}`;
      assert.equal(path, vaultListMediaPath("88002", offset));
      assert.equal("reason" in auth, false);
      if (!("reason" in auth)) {
        const signed = signedHeaders(rules, path, auth, now);
        assert.equal(new Headers(init?.headers).get("sign"), signed.sign);
        assert.equal(new Headers(init?.headers).get("time"), signed.time);
      }
      assert.equal(url.searchParams.get("list"), "88002");
      assert.equal(url.searchParams.get("field"), "recent");
      assert.equal(url.searchParams.get("sort"), "desc");
      assert.equal(url.searchParams.get("limit"), "40");
      if (offset === 0) {
        return Response.json({
          medias: Array.from({ length: 40 }, (_, index) => ({ id: index + 1, type: "photo" })),
          hasMore: true,
        });
      }
      return Response.json({
        medias: [{ id: 41, type: "photo" }, { id: 42, type: "video" }, { id: 43, type: "photo" }],
        hasMore: false,
      });
    }) as typeof fetch;
    const walked = await walkVault({
      creatorId: "3zk7kbr",
      state: storedState(),
      fetch: fetchImpl,
      now: () => now,
      sql: asSql(db),
      sleep: async () => undefined,
      listId: "88002",
    });
    assert.equal(walked.items.length, 43);
    assert.equal(seen.filter((href) => href.includes("/vault/lists/88002/media") && href.includes("offset=0")).length, 1);
    assert.equal(seen.some((href) => href.includes("/vault/lists/88002/media") && href.includes("offset=40")), true);
    assert.equal(seen.some((href) => href.includes("/vault/media") && href.includes("list=88002")), false);
    assert.equal(lines.some((line) => line.includes("fin lista=") && line.includes("paginas=2") && line.includes("medios=43")), true);
    assert.equal(lines.some((line) => line.includes("paginas=0")), false);
  } finally {
    console.info = previous;
    clearSignRulesCache();
    clearVaultWalkCache();
    await db.close();
  }
});

test("un 500 en la carpeta se reintenta y la página queda contada", async () => {
  clearSignRulesCache();
  clearVaultWalkCache();
  const db = new PGlite();
  const lines: string[] = [];
  const waits: number[] = [];
  const previous = console.info;
  console.info = (line?: unknown) => {
    lines.push(String(line));
  };
  let hits = 0;
  try {
    await migrateVault(db);
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const href = String(input);
      if (href.includes("dynamic-rules")) return Response.json(RULES);
      if (isVaultListsIndex(href)) {
        return Response.json({
          list: [{ id: 88021, type: "custom", name: "Sub", photosCount: 4, videosCount: 2, hasMedia: true }],
          hasMore: false,
        });
      }
      const url = new URL(href);
      if (url.pathname.endsWith("/vault/lists/88021/media")) {
        hits += 1;
        if (hits < 3) return new Response("no", { status: 500 });
        return Response.json({ medias: [{ id: 7, type: "photo" }, { id: 8, type: "video" }], hasMore: false });
      }
      return new Response("no", { status: 404 });
    }) as typeof fetch;
    const walked = await walkVault({
      creatorId: "3zk7kbr",
      state: storedState(),
      fetch: fetchImpl,
      now: () => 1_700_000_000_000,
      sql: asSql(db),
      sleep: async (ms: number) => {
        waits.push(ms);
      },
      listId: "88021",
    });
    assert.equal(walked.items.length, 2);
    assert.equal(hits, 3);
    assert.equal(waits.filter((ms) => ms >= 800).length >= 2, true);
    const printed = lines.join("\n");
    assert.match(printed, new RegExp(`list=${vaultFolderMark("88021")}`));
    assert.match(printed, /status=500/);
    assert.match(printed, /motivo=/);
    assert.equal(printed.includes("paginas=0"), false);
    assert.equal(printed.includes("88021"), false);
  } finally {
    console.info = previous;
    clearSignRulesCache();
    clearVaultWalkCache();
    await db.close();
  }
});

test("un 4xx de lists/id/media usa la variante de la web y se queda con los medios", async () => {
  clearSignRulesCache();
  clearVaultWalkCache();
  const db = new PGlite();
  const lines: string[] = [];
  const seen: string[] = [];
  const previous = console.info;
  console.info = (line?: unknown) => {
    lines.push(String(line));
  };
  const name = "Secreto Carpeta";
  try {
    await migrateVault(db);
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const href = String(input);
      seen.push(href);
      if (href.includes("dynamic-rules")) return Response.json(RULES);
      if (isVaultListsIndex(href)) {
        return Response.json({
          list: [{ id: 88022, type: "custom", name, photosCount: 4, videosCount: 2, hasMedia: true }],
          hasMore: false,
        });
      }
      const url = new URL(href);
      if (url.pathname.endsWith("/vault/lists/88022/media")) return new Response("no", { status: 404 });
      if (url.pathname.endsWith("/vault/media") && url.searchParams.get("list") === "88022" && !url.searchParams.get("name")) {
        return Response.json({ medias: [], hasMore: false });
      }
      if (url.pathname.endsWith("/vault/media") && url.searchParams.get("name") === name) {
        return Response.json({ medias: [{ id: 11, type: "photo" }, { id: 12, type: "video" }], hasMore: false });
      }
      return new Response("no", { status: 404 });
    }) as typeof fetch;
    const walked = await walkVault({
      creatorId: "3zk7kbr",
      state: storedState(),
      fetch: fetchImpl,
      now: () => 1_700_000_000_000,
      sql: asSql(db),
      sleep: async () => undefined,
      listId: "88022",
    });
    assert.deepEqual(walked.items.map((item) => item.id).sort(), ["11", "12"]);
    assert.equal(seen.some((href) => href.includes("/vault/lists/88022/media")), true);
    assert.equal(seen.some((href) => href.includes("/vault/media") && href.includes("list=88022") && href.includes("name=")), true);
    const printed = lines.join("\n");
    assert.equal(printed.includes(name), false);
    assert.equal(printed.includes("88022"), false);
    assert.match(printed, /status=404/);
    assert.match(printed, /motivo=/);
    assert.match(printed, new RegExp(`list=${vaultFolderMark("88022")}`));
  } finally {
    console.info = previous;
    clearSignRulesCache();
    clearVaultWalkCache();
    await db.close();
  }
});

test("si la primera página falla, cuenta la página y no marca la carpeta como vacía", async () => {
  clearSignRulesCache();
  clearVaultWalkCache();
  const db = new PGlite();
  const lines: string[] = [];
  const previous = console.info;
  console.info = (line?: unknown) => {
    lines.push(String(line));
  };
  try {
    await migrateVault(db);
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const href = String(input);
      if (href.includes("dynamic-rules")) return Response.json(RULES);
      if (isVaultListsIndex(href)) {
        return Response.json({
          list: [{ id: 88023, type: "custom", name: "Sub", photosCount: 4, videosCount: 2, hasMedia: true }],
          hasMore: false,
        });
      }
      if (new URL(href).pathname.endsWith("/vault/lists/88023/media")) return new Response("no", { status: 500 });
      return new Response("no", { status: 404 });
    }) as typeof fetch;
    const walked = await walkVault({
      creatorId: "3zk7kbr",
      state: storedState(),
      fetch: fetchImpl,
      now: () => 1_700_000_000_000,
      sql: asSql(db),
      sleep: async () => undefined,
      listId: "88023",
    });
    assert.equal(walked.items.length, 0);
    assert.equal(walked.reason, "No se ha podido leer la carpeta");
    const printed = lines.join("\n");
    assert.match(printed, /paginas=1/);
    assert.equal(printed.includes("paginas=0"), false);
    assert.match(printed, /status=500/);
    assert.match(printed, /motivo=/);
    assert.match(printed, /error=sin-medios fotos=4 videos=2/);
    assert.equal(printed.includes("vacío"), false);
    assert.equal(printed.includes("88023"), false);
    const view = await queryVaultForActor(asSql(db), { userId: "dueña", role: "owner", perms: ["vault"] }, {
      creatorId: "3zk7kbr",
      remember: false,
      query: { ...emptyVaultQuery(), folderId: "88023", scope: "carpeta" },
    });
    assert.equal(view.payload.notice, "No se ha podido leer la carpeta");
    assert.equal(view.payload.lists.find((list) => list.id === "88023")?.photos, 4);
    assert.equal(view.payload.lists.find((list) => list.id === "88023")?.videos, 2);
    assert.notEqual(vaultFolderLabel({
      photos: 4,
      videos: 2,
      gifs: 0,
      audios: 0,
      hasMedia: true,
    }, { photos: 0, videos: 0, gifs: 0 }), "vacío");
  } finally {
    console.info = previous;
    clearSignRulesCache();
    clearVaultWalkCache();
    await db.close();
  }
});

test("un 200 vacío con fotos en el catálogo prueba vault/media?list=", async () => {
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
    await migrateVault(db);
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const href = String(input);
      seen.push(href);
      if (href.includes("dynamic-rules")) return Response.json(RULES);
      if (isVaultListsIndex(href)) {
        return Response.json({
          list: [{ id: 88024, type: "custom", name: "Sub", photosCount: 4, videosCount: 2, hasMedia: true }],
          hasMore: false,
        });
      }
      const url = new URL(href);
      if (url.pathname.endsWith("/vault/lists/88024/media")) return Response.json({ medias: [], hasMore: false });
      if (url.pathname.endsWith("/vault/media") && url.searchParams.get("list") === "88024" && !url.searchParams.get("name")) {
        return Response.json({ medias: [{ id: 21, type: "photo" }, { id: 22, type: "video" }], hasMore: false });
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
      listId: "88024",
    });
    assert.deepEqual(walked.items.map((item) => item.id).sort(), ["21", "22"]);
    assert.equal(walked.signatureRejected, false);
    assert.equal(seen.some((href) => href.includes("/vault/lists/88024/media")), true);
    assert.equal(seen.some((href) => href.includes("/vault/media") && href.includes("list=88024")), true);
    assert.equal(lines.join("\n").includes("88024"), false);
  } finally {
    console.info = previous;
    clearSignRulesCache();
    clearVaultWalkCache();
    await db.close();
  }
});

test("un 400 de lists/id/media es un error de carpeta y no pausa la cuenta", async () => {
  clearSignRulesCache();
  clearVaultWalkCache();
  clearAccountPauses();
  const db = new PGlite();
  try {
    await migrateVault(db);
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const href = String(input);
      if (href.includes("dynamic-rules")) return Response.json(RULES);
      if (isVaultListsIndex(href)) {
        return Response.json({
          list: [{ id: 88025, type: "custom", name: "Sub", photosCount: 4, videosCount: 2, hasMedia: true }],
          hasMore: false,
        });
      }
      const url = new URL(href);
      if (url.pathname.endsWith("/vault/media") && url.searchParams.get("list") === "all") return new Response("no", { status: 400 });
      if (url.pathname.endsWith("/vault/lists/88025/media")) return new Response("no", { status: 400 });
      if (url.pathname.endsWith("/vault/media")) return new Response("no", { status: 400 });
      return new Response("no", { status: 404 });
    }) as typeof fetch;
    const signed = await fetchSignedVault(storedState(), {
      fetch: fetchImpl,
      now: () => 1_700_000_000_000,
    }, "all", 0, { includeLists: false, includeMedia: true });
    assert.equal(signed.signatureRejected, true);
    const view = await readChatVaultView({ creatorId: "3zk7kbr", listId: "88025", offset: 0 }, {
      fetch: fetchImpl,
      now: () => 1_700_000_000_000,
      sql: asSql(db),
      sleep: async () => undefined,
      access: { role: "owner", perms: ["vault"] },
      sessions: {
        listAccounts: async () => [{
          id: "acc-carpeta-400",
          creatorId: "3zk7kbr",
          label: "Prueba",
          status: "active",
          loginInProgress: false,
          sessionRejected: false,
          hasStorageState: true,
          connection: "live",
          identityState: "unavailable",
          identityLabel: null,
          identityHandle: null,
          identityName: null,
          identityUserId: null,
          identityCheckedAt: null,
          identityReason: null,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          lastCheckedAt: null,
          lastError: null,
        } satisfies Account],
        readStorageState: async () => storedState(),
        borrowProfile: async () => {
          throw new Error("no");
        },
      },
    });
    assert.equal(view.reason, VAULT_FOLDER_READ_ERROR);
    assert.equal(view.items.length, 0);
    assert.equal(accountPause("acc-carpeta-400"), null);
  } finally {
    clearAccountPauses();
    clearSignRulesCache();
    clearVaultWalkCache();
    await db.close();
  }
});

test("un catálogo solo con GIF también marca la carpeta como no leída", async () => {
  clearSignRulesCache();
  clearVaultWalkCache();
  const db = new PGlite();
  try {
    await migrateVault(db);
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const href = String(input);
      if (href.includes("dynamic-rules")) return Response.json(RULES);
      if (isVaultListsIndex(href)) {
        return Response.json({
          list: [{ id: 88026, type: "custom", name: "Gif", photosCount: 0, videosCount: 0, gifsCount: 2, audiosCount: 0, hasMedia: true }],
          hasMore: false,
        });
      }
      return Response.json({ medias: [], hasMore: false });
    }) as typeof fetch;
    const walked = await walkVault({
      creatorId: "3zk7kbr",
      state: storedState(),
      fetch: fetchImpl,
      now: () => 1_700_000_000_000,
      sql: asSql(db),
      sleep: async () => undefined,
      listId: "88026",
    });
    assert.equal(walked.items.length, 0);
    assert.equal(walked.reason, VAULT_FOLDER_READ_ERROR);
    const view = await queryVaultForActor(asSql(db), { userId: "dueña", role: "owner", perms: ["vault"] }, {
      creatorId: "3zk7kbr",
      remember: false,
      query: { ...emptyVaultQuery(), folderId: "88026", scope: "carpeta" },
    });
    assert.equal(view.payload.notice, VAULT_FOLDER_READ_ERROR);
    assert.equal(view.payload.lists.find((list) => list.id === "88026")?.gifs, 2);
  } finally {
    clearSignRulesCache();
    clearVaultWalkCache();
    await db.close();
  }
});

async function migrateVault(db: PGlite): Promise<void> {
  for (const file of ["0037_vault_mirror.sql", "0038_vault_fan_filter.sql", "0040_vault_full_tags.sql", "0042_vault_paid_with.sql", "0044_vault_thumb_page.sql", "0050_vault_list_counts.sql", "0051_vault_list_media.sql"]) {
    await db.exec(await readFile(path.join(root, "migrations", file), "utf8"));
  }
}

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
