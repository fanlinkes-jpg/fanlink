import assert from "node:assert/strict";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { chromium } from "playwright";
import { AccountStore } from "../store/account-store.ts";

const root = path.resolve(import.meta.dirname, "../../..");
const port = 18741;

test("el hilo pinta el medio, el candado y el pagado", async () => {
  const dir = path.join(tmpdir(), `fanlink-mirror-${Date.now()}`);
  await seed(dir);
  const server = startDev(dir);
  const browser = await chromium.launch();
  try {
    await waitForServer(`http://127.0.0.1:${port}/mensajes`);
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(`http://127.0.0.1:${port}/mensajes`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: /Fan Uno/ }).click();
    await page.getByText("$150.00 paid").waitFor();
    await page.getByText("Purchased — has purchased your message for $20.00").first().waitFor();
    await page.getByText("ELENA").waitFor();
    await page.getByLabel("Bloqueado").waitFor();
    await page.getByLabel("Reproducir").waitFor();
    const shot = path.join(root, "tmp/chat-layout/hilo-medios-1440x900.png");
    await mkdir(path.dirname(shot), { recursive: true });
    await page.screenshot({ path: shot });
    const image = await page.locator("ol img").first().getAttribute("src");
    assert.match(image ?? "", /\/api\/chat-media/);
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
  await pg.exec("insert into staff_profile (user_id, display_name, role, perms) values ('e-elena', 'Elena', 'member', '[]'::jsonb)");
  await pg.exec(`insert into of_chat_thread (
    creator_id, thread_key, fan_key, fan_name, fan_handle, last_message_at, excerpt, unread, synced_at, origin, last_from_fan
  ) values (
    'cpreview', '7', '7', 'Fan Uno', 'fanuno', '2026-11-06T12:00:00Z', 'set', 0, now(), 'onlyfans', false
  )`);
  const media = JSON.stringify([{
    kind: "video",
    seconds: 12,
    preview: "https://cdn.example/thumb.jpg",
    locked: true,
    priceCents: 15000,
    paid: true,
    opened: true,
  }]);
  await pg.query(
    `insert into of_chat_message (
       creator_id, message_key, thread_key, fan_key, from_fan, body, sent_at, price_cents, purchased, synced_at, origin,
       author_id, seen, automatic, media_count, media_seconds, media_preview, media_json, liked
     ) values (
       'cpreview', 'mmedia', '7', '7', false, 'el set', '2026-11-06T12:00:00Z', 15000, true, now(), 'onlyfans',
       'e-elena', true, true, 1, 12, 'https://cdn.example/thumb.jpg', $1, true
     )`,
    [media],
  );
  await pg.exec(`insert into of_chat_message (
    creator_id, message_key, thread_key, fan_key, from_fan, body, sent_at, synced_at, origin, event_kind, event_cents
  ) values (
    'cpreview', 'mbuy', '7', '7', true, 'Purchased — has purchased your message for $20.00', '2026-11-06T12:05:00Z', now(), 'onlyfans', 'compra', 2000
  )`);
  await pg.close();
  const store = new AccountStore(path.join(dir, "accounts.json"));
  await store.init();
  await store.create("Preview", "cpreview");
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  const cache = path.join(dir, "media-cache", "cpreview", "mmedia", "0");
  await mkdir(path.dirname(cache), { recursive: true });
  await writeFile(cache, png);
}

function startDev(dir: string): ChildProcess {
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
