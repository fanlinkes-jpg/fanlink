import assert from "node:assert/strict";
import { mkdir, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { chromium } from "playwright";
import { AccountStore } from "../store/account-store.ts";

const root = path.resolve(import.meta.dirname, "../../..");

test("las pestañas de creadora caben en 1280 y los badges no se pisan", async () => {
  const dir = path.join(tmpdir(), `fanlink-tabs-${Date.now()}`);
  await seed(dir);
  const port = await freePort();
  const server = startDev(dir, port);
  const browser = await chromium.launch();
  try {
    await waitForServer(`http://127.0.0.1:${port}/mensajes`);
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(`http://127.0.0.1:${port}/mensajes`, { waitUntil: "domcontentloaded" });
    const tabs = page.getByRole("tablist", { name: "Creadoras" });
    await tabs.getByRole("tab", { name: "Allison Miller" }).waitFor();
    await tabs.getByRole("tab", { name: /Jose/ }).getByText("128", { exact: true }).waitFor();
    await tabs.getByRole("tab", { name: "Allison Miller" }).getByText("256", { exact: true }).waitFor();
    assert.equal(await tabs.getByRole("tab", { name: "9ikis52" }).count(), 0);
    const layout = await tabs.evaluate((node) => {
      const box = node.getBoundingClientRect();
      const badges = [...node.querySelectorAll("[data-badge]")].map((badge) => {
        const rect = badge.getBoundingClientRect();
        return { text: badge.textContent, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
      });
      return { scroll: node.scrollWidth > node.clientWidth + 1, width: box.width, badges };
    });
    assert.equal(layout.scroll, true);
    assert.ok(layout.width < 1280);
    for (let index = 0; index < layout.badges.length; index += 1) {
      for (let other = index + 1; other < layout.badges.length; other += 1) {
        const left = layout.badges[index];
        const right = layout.badges[other];
        if (!left || !right) continue;
        const overlap = left.left < right.right && right.left < left.right && left.top < right.bottom && right.top < left.bottom;
        assert.equal(overlap, false, `${left.text} pisa a ${right.text}`);
      }
    }
    await page.screenshot({ path: "/opt/cursor/artifacts/creator-tabs-1280.png" });
    await page.close();
  } finally {
    await browser.close().catch(() => undefined);
    server.kill("SIGTERM");
  }
});

async function seed(dir: string): Promise<void> {
  const pgDir = path.join(dir, "pglite");
  await mkdir(pgDir, { recursive: true });
  const pg = new PGlite(pgDir);
  await pg.waitReady;
  await pg.exec("create table if not exists _migrations (name text primary key, applied_at timestamptz not null default now())");
  const folder = path.join(root, "migrations");
  const files = (await readdir(folder)).filter((name) => name.endsWith(".sql")).sort();
  for (const name of files) {
    await pg.exec(await readFile(path.join(folder, name), "utf8"));
    await pg.query("insert into _migrations (name) values ($1) on conflict do nothing", [name]);
  }
  const creators = ["Jose", "Baby Rabbit", "Allison Miller", "Elena Vargas del Río", "Nora Castillo", "Claudia Fernandez"].map((name, index) => ({
    id: name === "Jose" ? "jose" : name === "Allison Miller" ? "allison" : `c${index}`,
    name,
    handle: `@${name.split(" ")[0]?.toLowerCase()}`,
    platform: "onlyfans",
    city: "España",
    subscribers: 0,
    revenue30: null,
    growth: 0,
    split: 25,
    status: "activa",
    hue: index * 40,
    proxy: "",
    staff: [],
  }));
  await pg.query(
    "insert into workspace_state (id, state, version, updated_by) values (1, $1::jsonb, 1, 'dev-user')",
    [JSON.stringify({
      agency: "Fanlink",
      creators,
      fans: [],
      messages: [],
      vault: [],
      scripts: [],
      lists: [],
      campaigns: [],
      employees: [],
      links: [],
      automations: [],
      history: [],
      stopWords: [],
      copilot: true,
      translate: true,
      adaptPrices: true,
      notifyShifts: true,
    })],
  );
  await pg.exec(`insert into of_chat_thread (
    creator_id, thread_key, fan_key, fan_name, last_message_at, excerpt, unread, synced_at, origin
  )
  select 'jose', n::text, n::text, 'Fan', now(), 'hola', 1, now(), 'onlyfans'
  from generate_series(1, 128) n`);
  await pg.exec(`insert into of_chat_thread (
    creator_id, thread_key, fan_key, fan_name, last_message_at, excerpt, unread, synced_at, origin
  ) values (
    '9ikis52', '1', '1', 'Oculta', now(), 'hola', 4, now(), 'onlyfans'
  )`);
  await pg.exec(`insert into of_notification (creator_id, notification_key, kind, body, synced_at, origin, first_seen_at)
    select 'allison', 'n' || n, 'like', 'hola', now(), 'onlyfans', now()
    from generate_series(1, 256) n`);
  await pg.exec(`insert into of_notification_sync (creator_id, last_status, consecutive_failures, last_attempt_at)
    values ('allison', 'ok', 0, now())`);
  await pg.close();
  const store = new AccountStore(path.join(dir, "accounts.json"));
  await store.init();
  await store.create("Jose", "jose");
  await store.create("Allison", "allison");
  await store.create("Oculta", "9ikis52");
}

function startDev(dir: string, port: number): ChildProcess {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    VITE_AUTH_ENABLED: "false",
    FANLINK_DATA_DIR: dir,
    FANLINK_PGLITE_DIR: path.join(dir, "pglite"),
    FANLINK_SYNC_ENABLED: "false",
    FANLINK_HISTORY_ENABLED: "false",
  };
  delete env.DATABASE_URL;
  return spawn(process.execPath, ["node_modules/vite/bin/vite.js", "dev", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
    cwd: root,
    env,
    stdio: "ignore",
  });
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const chosen = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(chosen));
    });
  });
}

async function waitForServer(url: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  let last = "sin respuesta";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok || response.status < 500) return;
      last = String(response.status);
    } catch (err) {
      last = err instanceof Error ? err.message : "error";
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`el servidor no arrancó: ${last}`);
}
