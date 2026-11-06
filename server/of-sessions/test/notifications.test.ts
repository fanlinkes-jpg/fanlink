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
import { listNotificationRows, markNotificationsSeen, saveNotificationRead } from "../sync/notification-store.ts";

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
    assert.equal(await markNotificationsSeen(sql, "c-alba", ["n1"]), 1);
    await saveNotificationRead(sql, "c-alba", {
      captured: true,
      reason: null,
      items: [
        { key: "n1", kind: "like", body: null, fanKey: null, fanName: null, threadKey: null, amountCents: null, occurredAt: null, pending: false },
      ],
    });
    const rows = await listNotificationRows(sql, "c-alba");
    const first = rows.find((row) => row.key === "n1");
    assert.equal(first?.body, "hola");
    assert.equal(first?.fanName, "Ana");
    assert.ok(first?.seenAt);
    const second = rows.find((row) => row.key === "n2");
    assert.equal(second?.body, null);
    assert.equal(second?.seenAt, null);
  } finally {
    await pg.close();
  }
});

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
  await pg.exec(await readFile(path.join(root, "migrations/0030_notifications.sql"), "utf8"));
  const sql = {
    query: async <T>(text: string, params: unknown[] = []) => (await pg.query<T>(text, params)).rows,
  };
  return { pg, sql };
}
