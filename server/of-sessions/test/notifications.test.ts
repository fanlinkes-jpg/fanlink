import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { collectNotifications } from "../sync/collect-notifications.ts";
import { listNotificationRows, markNotificationPage, markNotificationsSeen, notificationPageFor, saveNotificationRead } from "../sync/notification-store.ts";
import { dashboardCreatorIds } from "../../../src/lib/dashboard-config.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

test("la página pide las notificaciones y el lector no llama a la API", async () => {
  const hits = { notifications: 0, other: 0 };
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/my/notifications") {
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end(`<!doctype html><div style="height:4000px"></div><script>
        fetch("/api2/v2/users/notifications?offset=0&token=sekret");
        window.addEventListener("scroll", () => {
          if (window.__more) return;
          window.__more = 1;
          fetch("/api2/v2/users/notifications?offset=10&token=sekret");
        });
      </script>`);
      return;
    }
    if (url.pathname === "/api2/v2/users/notifications") {
      hits.notifications += 1;
      const second = url.searchParams.get("offset") === "10";
      const list = second
        ? [{ id: "n2", type: "like", text: "Ana indicó me gusta", createdAt: "2026-11-04T10:00:00.000Z", user: { id: 8, name: "Ana" } }]
        : [
            { id: "n1", type: "tip", text: "Juan dejó propina", createdAt: "2026-11-05T10:00:00.000Z", user: { id: 7, name: "Juan" }, amount: 5 },
            { id: "n3", type: "tag", text: "Etiqueta pendiente de Luis", createdAt: "2026-11-03T10:00:00.000Z", status: "pending" },
          ];
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ list }));
      return;
    }
    if (url.pathname.includes("/api2/")) hits.other += 1;
    res.statusCode = 404;
    res.end("no");
  });
  const origin = await listen(server);
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    const read = await collectNotifications(context, site(origin), { paceMs: 30, waitMs: 2_000, scrolls: 1 });
    assert.equal(hits.other, 0);
    assert.equal(hits.notifications, 2);
    assert.equal(read.captured, true);
    assert.equal(read.reason, null);
    assert.deepEqual(read.jsonPaths, [`${origin}/api2/v2/users/notifications`]);
    const keys = read.items.map((item) => item.key).sort();
    assert.deepEqual(keys, ["n1", "n2", "n3"]);
    assert.equal(read.items.find((item) => item.key === "n1")?.amountCents, 500);
    assert.equal(read.items.find((item) => item.key === "n3")?.pending, true);
    const quiet = await collectNotifications(context, site(origin), { paceMs: 0, waitMs: 1_500, scrolls: 0 });
    assert.equal(hits.notifications, 3);
    assert.equal(quiet.items.some((item) => item.key === "n2"), false);
  } finally {
    await browser.close();
    await close(server);
  }
});

test("guardar no borra lo ya leído y no inventa un cuerpo", async () => {
  const { pg, sql } = await database();
  try {
    await saveNotificationRead(sql, "c-alba", {
      captured: true,
      reason: null,
      items: [
        { key: "n1", kind: "like", body: "hola", fanKey: "7", fanName: "Ana", threadKey: null, amountCents: null, occurredAt: "2026-11-04T10:00:00.000Z", pending: false },
        { key: "n2", kind: "ppv", body: null, fanKey: null, fanName: null, threadKey: "77", amountCents: null, occurredAt: "2026-11-05T10:00:00.000Z", pending: false },
      ],
    });
    assert.equal(await markNotificationsSeen(sql, "c-alba", "dueña", ["n1"]), 1);
    await saveNotificationRead(sql, "c-alba", {
      captured: true,
      reason: null,
      items: [
        { key: "n1", kind: "like", body: null, fanKey: null, fanName: null, threadKey: null, amountCents: null, occurredAt: null, pending: false },
        { key: "n2", kind: "other", body: null, fanKey: null, fanName: null, threadKey: null, amountCents: null, occurredAt: "2026-11-05T10:00:00.000Z", pending: false },
      ],
    });
    const rows = (await listNotificationRows(sql, "c-alba", "dueña")).rows;
    const first = rows.find((row) => row.key === "n1");
    assert.equal(first?.body, "hola");
    assert.equal(first?.fanName, "Ana");
    assert.ok(first?.seenAt);
    const second = rows.find((row) => row.key === "n2");
    assert.equal(second?.kind, "ppv");
    assert.equal(second?.body, null);
    assert.equal(second?.seenAt, null);
    const otherPerson = (await listNotificationRows(sql, "c-alba", "chatter")).rows.find((row) => row.key === "n1");
    assert.equal(otherPerson?.seenAt, null);
  } finally {
    await pg.close();
  }
});

test("la lista pagina y olvida lo que pasa de 90 días", async () => {
  const { pg, sql } = await database();
  try {
    const old = new Date(Date.now() - 100 * 86_400_000).toISOString();
    await saveNotificationRead(sql, "c-alba", {
      captured: true,
      reason: null,
      items: [
        { key: "vieja", kind: "like", body: "antigua", fanKey: null, fanName: null, threadKey: null, amountCents: null, occurredAt: old, pending: false },
        { key: "a", kind: "like", body: "a", fanKey: null, fanName: null, threadKey: null, amountCents: null, occurredAt: "2026-11-03T10:00:00.000Z", pending: false },
        { key: "b", kind: "like", body: "b", fanKey: null, fanName: null, threadKey: null, amountCents: null, occurredAt: "2026-11-04T10:00:00.000Z", pending: false },
        { key: "c", kind: "like", body: "c", fanKey: null, fanName: null, threadKey: null, amountCents: null, occurredAt: "2026-11-05T10:00:00.000Z", pending: false },
      ],
    });
    const first = await listNotificationRows(sql, "c-alba", "dueña", { limit: 2 });
    assert.deepEqual(first.rows.map((row) => row.key), ["c", "b"]);
    assert.ok(first.nextCursor);
    const second = await listNotificationRows(sql, "c-alba", "dueña", { limit: 2, cursor: first.nextCursor });
    assert.deepEqual(second.rows.map((row) => row.key), ["a"]);
    assert.equal(second.rows.some((row) => row.key === "vieja"), false);
  } finally {
    await pg.close();
  }
});

test("agencia y desconocido no pasan a un tipo que vea el chatter", async () => {
  const { pg, sql } = await database();
  try {
    await saveNotificationRead(sql, "c-alba", {
      captured: true,
      reason: null,
      items: [
        item("ag", "agency", "2026-11-05T10:00:00.000Z"),
        item("un", "other", "2026-11-05T09:00:00.000Z"),
      ],
    });
    await saveNotificationRead(sql, "c-alba", {
      captured: true,
      reason: null,
      items: [item("ag", "tip", "2026-11-05T10:00:00.000Z"), item("un", "like", "2026-11-05T09:00:00.000Z")],
    });
    const rows = (await listNotificationRows(sql, "c-alba", "dueña", { role: "owner" })).rows;
    assert.equal(rows.find((row) => row.key === "ag")?.kind, "agency");
    assert.equal(rows.find((row) => row.key === "un")?.kind, "other");
  } finally {
    await pg.close();
  }
});

test("el chatter no recibe páginas vacías ni la cuenta de otra persona", async () => {
  const { pg, sql } = await database();
  try {
    await saveNotificationRead(sql, "c-alba", {
      captured: true,
      reason: null,
      items: [
        item("ag1", "agency", "2026-11-05T12:00:00.000Z"),
        item("ag2", "agency", "2026-11-05T11:00:00.000Z"),
        item("tip", "tip", "2026-11-05T10:00:00.000Z"),
        item("ppv", "ppv", "2026-11-04T10:00:00.000Z"),
      ],
    });
    await saveNotificationRead(sql, "c-nora", {
      captured: true,
      reason: null,
      items: [item("ajena", "tip", "2026-11-05T10:00:00.000Z")],
    });
    const page = await listNotificationRows(sql, "c-alba", "chatter", { role: "member", limit: 2 });
    assert.deepEqual(page.rows.map((row) => row.kind), ["tip", "ppv"]);
    const chatter = { userId: "chatter", role: "member" as const, creatorIds: ["c-alba"] };
    const foreign = await notificationPageFor(sql, chatter, "c-nora");
    assert.deepEqual(foreign.items, []);
    await assert.rejects(() => markNotificationPage(sql, chatter, "c-nora", ["tip"]), /cuenta/);
    const own = await notificationPageFor(sql, chatter, "c-alba", null);
    assert.deepEqual(own.items.map((row) => row.kind), ["tip", "ppv"]);
    assert.equal(own.items[0]?.amountCents, 500);
    const still = (await listNotificationRows(sql, "c-alba", "dueña", { role: "owner" })).rows.find((row) => row.key === "tip");
    assert.equal(still?.seenAt, null);
    assert.deepEqual(dashboardCreatorIds(chatter, [{ creatorId: "c-alba" }, { creatorId: "c-nora" }]), ["c-alba"]);
    const first = await listNotificationRows(sql, "c-alba", "dueña", { role: "owner", cursor: "no-es-json" });
    const clean = await listNotificationRows(sql, "c-alba", "dueña", { role: "owner" });
    assert.deepEqual(first.rows.map((row) => row.key), clean.rows.map((row) => row.key));
  } finally {
    await pg.close();
  }
});

test("un aviso sin fecha caduca desde la primera vez que se vio", async () => {
  const { pg, sql } = await database();
  try {
    await saveNotificationRead(sql, "c-alba", {
      captured: true,
      reason: null,
      items: [item("suelto", "like", null)],
    });
    const old = new Date(Date.now() - 100 * 86_400_000).toISOString();
    await sql.query("update of_notification set first_seen_at = $2 where creator_id = $1 and notification_key = $3", [
      "c-alba",
      old,
      "suelto",
    ]);
    await saveNotificationRead(sql, "c-alba", { captured: true, reason: null, items: [] });
    const rows = (await listNotificationRows(sql, "c-alba", "dueña", { role: "owner" })).rows;
    assert.equal(rows.some((row) => row.key === "suelto"), false);
  } finally {
    await pg.close();
  }
});

function item(key: string, kind: "agency" | "other" | "tip" | "ppv" | "like", occurredAt: string | null) {
  return {
    key,
    kind,
    body: kind,
    fanKey: "7",
    fanName: "Ana",
    threadKey: null,
    amountCents: 500,
    occurredAt,
    pending: false,
  };
}

function site(origin: string) {
  return {
    id: "fixture",
    probeUrl: `${origin}/`,
    notificationsUrl: `${origin}/my/notifications`,
    isLoginUrl: (url: string) => new URL(url).pathname.startsWith("/login"),
  };
}

function listen(server: Server): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("sin puerto");
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function database() {
  const dir = await mkdtemp(path.join(tmpdir(), "fanlink-notifications-"));
  const pg = new PGlite(dir);
  await pg.exec(await readFile(path.join(root, "migrations/0032_notifications.sql"), "utf8"));
  const sql = {
    query: async <T>(text: string, params: unknown[] = []) => (await pg.query<T>(text, params)).rows,
  };
  return { pg, sql };
}
