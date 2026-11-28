import assert from "node:assert/strict";
import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { chromium } from "playwright";
import { AccountStore } from "../store/account-store.ts";
import { assertDevPortFree, shotFile } from "../../../src/lib/dev-test-server.ts";

const root = path.resolve(import.meta.dirname, "../../..");

test("las pestañas de creadora caben en 1280 y los badges no se pisan", async () => {
  const dir = path.join(tmpdir(), `fanlink-tabs-${Date.now()}`);
  await seed(dir);
  const port = await freePort();
  const server = await startDev(dir, port);
  const browser = await chromium.launch();
  try {
    await waitForServer(`http://127.0.0.1:${port}/mensajes`);
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(`http://127.0.0.1:${port}/mensajes`, { waitUntil: "domcontentloaded" });
    const column = page.getByRole("complementary", { name: "Creadoras" });
    await column.getByRole("button", { name: "Allison Miller" }).waitFor();
    await column.getByRole("button", { name: /Jose/ }).getByText("128", { exact: true }).waitFor();
    await column.getByRole("button", { name: /Jose/ }).getByText("3", { exact: true }).waitFor();
    await column.getByRole("button", { name: "Allison Miller" }).getByText("256", { exact: true }).waitFor();
    assert.equal(await column.getByRole("button", { name: "9ikis52" }).count(), 0);
    assert.equal(await page.getByRole("link", { name: "Mensajes" }).count(), 0);
    assert.equal(await page.getByRole("combobox", { name: "Bandeja" }).count(), 0);
    assert.equal(await page.getByRole("textbox", { name: "Buscar fan" }).count(), 0);
    assert.equal(await page.getByText("Operador local").count(), 0);
    await page.getByRole("button", { name: "Traducción" }).click();
    await page.getByRole("option", { name: "Inglés" }).click();
    await page.getByRole("button", { name: "Translation", exact: true }).click();
    await page.getByRole("combobox", { name: "Idioma" }).selectOption("en");
    assert.equal(await page.getByRole("button", { name: "Traducción", exact: true }).innerText(), "EN");
    assert.equal(await page.getByRole("combobox", { name: "Idioma" }).inputValue(), "en");
    await column.getByRole("button", { name: /Jose/ }).click();
    await page.getByRole("button", { name: /^Notificaciones/ }).click();
    await page.getByText("Renew On").waitFor();
    await page.getByText("Renew Off").waitFor();
    const onlyfans = page.getByRole("button", { name: /OnlyFans/ });
    await onlyfans.evaluate((node) => {
      const scroller = node.parentElement;
      if (scroller) scroller.scrollLeft = scroller.scrollWidth;
    });
    assert.match(await onlyfans.innerText(), /OnlyFans\s+3/);
    assert.match(await page.locator("img[src^='data:image/svg+xml']").nth(1).getAttribute("src") ?? "", /^data:image\/svg\+xml/);
    await page.screenshot({ path: shotFile("notificaciones-of.png") });
    await page.getByRole("button", { name: "Cerrar notificaciones" }).evaluate((node) => (node as HTMLButtonElement).click());
    await page.getByRole("button", { name: "Cerrar notificaciones" }).waitFor({ state: "hidden" });
    await page.getByRole("switch", { name: "SFW" }).click();
    assert.equal(await page.evaluate(() => document.documentElement.dataset.sfw), "1");
    await page.getByRole("switch", { name: "SFW" }).click();
    assert.equal(await page.evaluate(() => document.documentElement.dataset.sfw), "0");
    const layout = await column.locator("ul").evaluate((node) => {
      const badges = [...node.querySelectorAll("[data-badge]")].map((badge) => {
        const rect = badge.getBoundingClientRect();
        return { text: badge.textContent, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
      });
      return { scroll: node.scrollHeight > node.clientHeight + 1, badges };
    });
    assert.equal(layout.scroll, true);
    for (let index = 0; index < layout.badges.length; index += 1) {
      for (let other = index + 1; other < layout.badges.length; other += 1) {
        const left = layout.badges[index];
        const right = layout.badges[other];
        if (!left || !right) continue;
        const overlap = left.left < right.right && right.left < left.right && left.top < right.bottom && right.top < left.bottom;
        assert.equal(overlap, false, `${left.text} pisa a ${right.text}`);
      }
    }
    await page.screenshot({ path: shotFile("creator-tabs-1280.png") });
    await column.getByRole("button", { name: "Allison Miller" }).click();
    const sections = [
      { path: "/mensajes", shot: shotFile("creadoras-mensajes-1280.png") },
      { path: "/notificaciones", shot: shotFile("creadoras-operativa-1280.png"), link: "Operativa" },
      { path: "/funciones", shot: shotFile("creadoras-funciones-1280.png"), link: "Funciones inteligentes" },
    ];
    let firstRows: string[] = [];
    for (const section of sections) {
      if (section.link) await page.getByRole("link", { name: section.link }).click();
      await page.waitForURL(new RegExp(section.path));
      const rail = page.locator("[data-creator-rail='shared']");
      await rail.getByRole("button", { name: "Allison Miller" }).waitFor();
      await rail.getByRole("button", { name: /Jose/ }).getByText("128", { exact: true }).waitFor();
      await rail.getByRole("button", { name: "Allison Miller" }).getByText("256", { exact: true }).waitFor();
      const active = rail.locator("[aria-current='true']");
      assert.equal(await active.getAttribute("data-creator-row"), "allison");
      assert.equal(await page.locator("[data-creator-rail='shared']").count(), 1);
      const header = page.locator("header");
      assert.equal(await header.getByRole("button", { name: "Traducción", exact: true }).count(), 1);
      assert.equal(await header.getByRole("switch", { name: "SFW" }).count(), 1);
      assert.equal(await header.locator("[data-creator-row]").count(), 0);
      assert.equal(await page.getByRole("link", { name: "Mensajes" }).count(), 0);
      const rows = await rail.locator("[data-creator-row]").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-creator-row") ?? ""));
      if (firstRows.length === 0) firstRows = rows;
      assert.deepEqual(rows, firstRows);
      assert.match(await rail.getAttribute("class") ?? "", /\bw-64\b/);
      await page.screenshot({ path: section.shot });
    }
    await page.close();
  } finally {
    await browser.close().catch(() => undefined);
    server.kill("SIGTERM");
    await rm(dir, { recursive: true, force: true });
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
  const names = ["Jose", "Baby Rabbit", "Allison Miller", "Elena Vargas del Río", "Nora Castillo", "Claudia Fernandez"];
  for (let extra = 7; extra <= 24; extra += 1) names.push(`Creadora ${extra} Modelo`);
  const creators = names.map((name, index) => ({
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
  await pg.exec(`insert into of_notification_sync (creator_id, last_status, consecutive_failures, last_attempt_at, unread_counts)
    values
      ('allison', 'ok', 0, now(), '{"all":256,"likes":256}'::jsonb),
      ('jose', 'ok', 0, now(), '{"all":3,"onlyfans":3}'::jsonb)`);
  const face = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='40'%3E%3Ccircle cx='20' cy='20' r='20' fill='%233b6cff'/%3E%3C/svg%3E";
  await pg.query(`insert into of_notification (
      creator_id, notification_key, kind, body, fan_key, fan_name, fan_handle, avatar_url, renew_auto,
      synced_at, origin, first_seen_at, occurred_at
    ) values
      ('jose', 'sub-lia', 'subscription', 'Nueva suscripción', 'fan-lia', 'Lia', 'lia', $1, true, now(), 'onlyfans', now(), now()),
      ('jose', 'sub-nora', 'subscription', 'Sin foto en el aviso', 'fan-nora', 'Nora', 'nora', null, null, now(), 'onlyfans', now(), now())`, [face]);
  await pg.query(`insert into of_chat_thread (
      creator_id, thread_key, fan_key, fan_name, fan_handle, last_message_at, excerpt, unread, synced_at, origin, avatar_url, renew_auto
    ) values (
      'jose', 'fan-nora', 'fan-nora', 'Nora', 'nora', now(), 'hola', 0, now(), 'onlyfans', $1, false
    )`, [face]);
  await pg.close();
  const store = new AccountStore(path.join(dir, "accounts.json"));
  await store.init();
  await store.create("Jose", "jose");
  await store.create("Allison", "allison");
  await store.create("Oculta", "9ikis52");
}

async function startDev(dir: string, port: number): Promise<ChildProcess> {
  await assertDevPortFree();
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
