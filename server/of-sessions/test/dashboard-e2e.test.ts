import assert from "node:assert/strict";
import { copyFile, mkdir, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { chromium, type Page } from "playwright";
import { AccountStore } from "../store/account-store.ts";
import { assertDevPortFree, shotFile } from "../../../src/lib/dev-test-server.ts";
import { presetPerms } from "../../../src/lib/staff-roles.ts";
import { lastCut } from "../../../src/lib/dashboard-cuts.ts";

/**
 * Dashboard con DATOS DE PRUEBA (no reales) en una pglite temporal: vista de Admin y vista de Chatter.
 * Las capturas van a shotFile() y, si existe FANLINK_SHOTS_DIR, también allí.
 */
const root = path.resolve(import.meta.dirname, "../../..");
const CREATORS = [["c-alba", "Alba", "vip"], ["c-nora", "Nora", "vip"], ["c-lucia", "Lucía", "nuevas"]] as const;

test("Dashboard: Admin ve todo con el dinero de la agencia; el Chatter solo lo suyo", { timeout: 600_000 }, async () => {
  const shots: string[] = [];
  const browser = await chromium.launch();
  try {
    for (const role of ["admin", "chatter"] as const) {
      const dir = path.join(tmpdir(), `fanlink-dash-${role}-${Date.now()}`);
      const agencyTotal = await seed(dir, role);
      const port = await freePort();
      const server = await startDev(dir, port);
      try {
        const base = `http://127.0.0.1:${port}`;
        await waitForServer(`${base}/`);
        const page = await browser.newPage({ viewport: { width: 1440, height: 2600 } });
        page.on("pageerror", (err) => console.log(`[pageerror] ${err.message}`));
        page.on("console", (message) => { if (message.type() === "error") console.log(`[console] ${message.text().slice(0, 300)}`); });
        const bodies: string[] = [];
        page.on("response", (response) => {
          const url = response.url();
          if (!url.startsWith(`${base}/_serverFn`)) return;
          void response.text().then((text) => bodies.push(text)).catch(() => undefined);
        });
        await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
        await page.getByTestId("insights-header").waitFor({ timeout: 90_000 });
        await page.getByTestId("updated-at").waitFor();
        assert.match(await page.getByTestId("updated-at").innerText(), /Actualizado/);
        await basisReady(page);
        const basis = page.getByTestId("basis-select");
        assert.equal(await basis.inputValue(), "net");
        if (role === "admin") {
          await page.getByTestId("resumen-agency").waitFor({ timeout: 60_000 }).catch(async (err) => {
            await shoot(page, "dashboard-debug.png");
            console.log((await page.locator("body").innerText()).slice(0, 1500));
            throw err;
          });
          await settle(page);
          shots.push(await shoot(page, "dashboard-admin-resumen.png"));
          for (const screen of ["creadoras", "rendimiento", "chatters", "nuevos", "segmentos"]) {
            await page.evaluate((hash) => { window.location.hash = hash; }, screen);
            await settle(page);
            shots.push(await shoot(page, `dashboard-admin-${screen}.png`));
          }
          await page.evaluate(() => { window.location.hash = "creadoras"; });
          await page.getByTestId("creator-stats").waitFor({ timeout: 30_000 });
        } else {
          await page.getByTestId("resumen-chatter").waitFor({ timeout: 60_000 });
          assert.equal(await page.getByTestId("resumen-agency").count(), 0);
          await settle(page);
          shots.push(await shoot(page, "dashboard-chatter-resumen.png"));
          for (const screen of ["chatters", "segmentos"]) {
            await page.evaluate((hash) => { window.location.hash = hash; }, screen);
            await settle(page);
            shots.push(await shoot(page, `dashboard-chatter-${screen}.png`));
          }
          // Por URL directa tampoco aparece la tabla por creadora.
          await page.evaluate(() => { window.location.hash = "creadoras"; });
          await settle(page);
          assert.equal(await page.getByTestId("creator-stats").count(), 0);
          const text = await page.locator("body").innerText();
          for (const word of ["Banco", "Estados de cuenta", "Lucía"]) assert.equal(text.includes(word), false, word);
          // Ninguna respuesta del servidor trae el total de la agencia.
          const joined = bodies.join("\n");
          assert.equal(joined.includes(`"totalCents":${agencyTotal}`), false);
          assert.equal(joined.includes("c-lucia"), false);
        }
        await page.close();
      } finally {
        await stop(server);
        await rm(dir, { recursive: true, force: true }).catch(() => undefined);
      }
    }
  } finally {
    await browser.close();
  }
  const extra = process.env.FANLINK_SHOTS_DIR;
  if (extra) {
    await mkdir(extra, { recursive: true });
    for (const file of shots) await copyFile(file, path.join(extra, path.basename(file)));
  }
});

async function basisReady(page: Page): Promise<void> {
  await page.getByTestId("basis-select").waitFor({ timeout: 90_000 });
}

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(2_500);
}

async function shoot(page: Page, name: string): Promise<string> {
  const file = shotFile(name);
  await mkdir(path.dirname(file), { recursive: true });
  await page.screenshot({ path: file, fullPage: true });
  return file;
}

/** Generador fijo: mismos datos de prueba en cada ejecución. */
function rng(seedValue: number): () => number {
  let state = seedValue >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

async function seed(dir: string, role: "admin" | "chatter"): Promise<number> {
  const pgDir = path.join(dir, "pglite");
  await mkdir(pgDir, { recursive: true });
  const pg = new PGlite(pgDir);
  await pg.waitReady;
  await pg.exec("create table if not exists _migrations (name text primary key, applied_at timestamptz not null default now())");
  const folder = path.join(root, "migrations");
  for (const name of (await readdir(folder)).filter((item) => item.endsWith(".sql")).sort()) {
    await pg.exec(await readFile(path.join(folder, name), "utf8"));
    await pg.query("insert into _migrations (name) values ($1) on conflict do nothing", [name]);
  }
  const creators = CREATORS.map(([id, name, tag], index) => ({
    id, name, tag, handle: `@${name.toLowerCase()}`, platform: "onlyfans", city: "España", subscribers: 0, revenue30: 0, growth: 0,
    split: 25, status: "activa", hue: index * 60, proxy: "", staff: [],
  }));
  await pg.query("insert into workspace_state (id, state, version, updated_by) values (1, $1::jsonb, 1, 'dueña')", [JSON.stringify({
    agency: "Fanlink", creators, fans: [], messages: [], vault: [], scripts: [], lists: [], campaigns: [], employees: [], links: [],
    automations: [], history: [], stopWords: [], copilot: true, translate: true, adaptPrices: true, notifyShifts: true,
  })]);
  await pg.exec(`insert into staff_profile (user_id, display_name, role, perms) values ('dueña', 'Dueña', 'owner', '[]'::jsonb)`);
  await pg.exec(`insert into workspace_member (user_id) values ('dev-user'), ('u-marta') on conflict do nothing`);
  if (role === "admin") {
    await pg.query(
      "insert into staff_profile (user_id, display_name, role, perms, level, roles) values ('dev-user', 'Ana (Admin)', 'member', $1::jsonb, 'admin', '[\"admin\"]'::jsonb)",
      [JSON.stringify(presetPerms(["admin"]))],
    );
  } else {
    await pg.query(
      "insert into staff_profile (user_id, display_name, role, perms, level, roles) values ('dev-user', 'Carla (Chatter)', 'member', $1::jsonb, 'chatter', '[\"chatter\"]'::jsonb)",
      [JSON.stringify(presetPerms(["chatter"]))],
    );
    await pg.exec(`insert into creator_grant (user_id, creator_id) values ('dev-user', 'c-alba'), ('dev-user', 'c-nora')`);
  }
  await pg.query(
    "insert into staff_profile (user_id, display_name, role, perms, level, roles, last_seen_at) values ('u-marta', 'Marta', 'member', $1::jsonb, 'chatter', '[\"chatter\"]'::jsonb, now() - interval '2 hours')",
    [JSON.stringify(presetPerms(["chatter"]))],
  );
  for (const [user, start, end] of [["dev-user", 8 * 60, 16 * 60], ["u-marta", 16 * 60, 23 * 60 + 59]] as const) {
    for (let weekday = 0; weekday < 7; weekday += 1) {
      await pg.query("insert into staff_shift (user_id, weekday, start_minutes, end_minutes, is_off) values ($1, $2, $3, $4, false)", [user, weekday, start, end]);
    }
  }

  const random = rng(20261128);
  const now = Date.now();
  const cut = lastCut(new Date(now));
  const DAY = 86_400_000;
  const kinds = ["message", "message", "message", "tip", "subscription", "renewal", "post", "tip", "message", "stream", "referral"] as const;
  let total = 0;
  let tx = 0;
  let msg = 0;
  for (const [creatorId, , ] of CREATORS) {
    const weight = creatorId === "c-alba" ? 1.4 : creatorId === "c-nora" ? 1 : 0.6;
    const fans = Array.from({ length: 28 }, (_, index) => `${creatorId}-fan${index + 1}`);
    for (const [index, fanKey] of fans.entries()) {
      const spent = Math.round(random() ** 2 * 40_000);
      const subscribedAt = new Date(now - Math.round(random() * 420) * DAY);
      const active = random() > 0.2;
      await pg.query(
        `insert into of_fan_read (creator_id, fan_key, of_user_id, handle, display_name, subscribed_at, status, spent_cents, synced_at, renew_auto, expires_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [creatorId, fanKey, String(1000 + index), `fan${index + 1}`, `Fan ${index + 1}`, subscribedAt.toISOString(), active ? "active" : "expired", spent, cut.toISOString(),
          index % 5 === 0 ? false : true, active ? null : new Date(subscribedAt.getTime() + Math.round(random() * 200) * DAY).toISOString()],
      );
    }
    for (let day = 0; day < 62; day += 1) {
      const count = Math.round((2 + random() * 6) * weight);
      for (let item = 0; item < count; item += 1) {
        const at = new Date(cut.getTime() - day * DAY - Math.round(random() * DAY));
        const kind = kinds[Math.floor(random() * kinds.length)] ?? "message";
        const gross = Math.round((kind === "subscription" || kind === "renewal" ? 999 : 500 + random() * 6_000) / 100) * 100;
        const fanKey = fans[Math.floor(random() * fans.length)] ?? null;
        tx += 1;
        await pg.query(
          `insert into of_transaction (creator_id, tx_key, occurred_at, gross_cents, net_cents, kind, fan_key, currency, synced_at)
           values ($1, $2, $3, $4, $5, $6, $7, 'USD', $8)`,
          [creatorId, `tx${tx}`, at.toISOString(), gross, Math.round(gross * 0.8), kind, fanKey, cut.toISOString()],
        );
        if (day < 30) total += Math.round(gross * 0.8);
        if (kind === "message") {
          const author = random() > 0.5 ? "dev-user" : "u-marta";
          msg += 1;
          await pg.query(
            `insert into of_chat_message (creator_id, message_key, thread_key, fan_key, from_fan, body, sent_at, synced_at, origin, price_cents, purchased, author_id)
             values ($1, $2, $3, $3, false, 'PPV', $4, now(), 'onlyfans', $5, true, $6)`,
            [creatorId, `m${msg}`, fanKey, new Date(at.getTime() - 20 * 60_000).toISOString(), gross, author],
          );
        }
      }
      for (let item = 0; item < 4; item += 1) {
        const fanKey = fans[Math.floor(random() * fans.length)] ?? "x";
        const at = new Date(cut.getTime() - day * DAY - Math.round(random() * DAY));
        msg += 1;
        await pg.query(
          `insert into of_chat_message (creator_id, message_key, thread_key, fan_key, from_fan, body, sent_at, synced_at, origin)
           values ($1, $2, $3, $3, true, 'hola', $4, now(), 'onlyfans')`,
          [creatorId, `m${msg}`, fanKey, at.toISOString()],
        );
        msg += 1;
        await pg.query(
          `insert into of_chat_message (creator_id, message_key, thread_key, fan_key, from_fan, body, sent_at, synced_at, origin, price_cents, purchased, author_id)
           values ($1, $2, $3, $3, false, 'respuesta', $4, now(), 'onlyfans', $5, $6, $7)`,
          [creatorId, `m${msg}`, fanKey, new Date(at.getTime() + Math.round(2 + random() * 25) * 60_000).toISOString(),
            item === 0 ? 1500 : null, item === 0 ? random() > 0.5 : null, random() > 0.5 ? "dev-user" : "u-marta"],
        );
      }
    }
    // El gasto total de OnlyFans nunca es menor que lo comprado en el rango.
    await pg.query(
      `update of_fan_read f set spent_cents = greatest(f.spent_cents, t.total)
         from (select fan_key, sum(gross_cents)::int as total from of_transaction where creator_id = $1 group by fan_key) t
        where f.creator_id = $1 and f.fan_key = t.fan_key`,
      [creatorId],
    );
    await pg.query(
      `insert into of_sync_state (creator_id, earnings_synced_at, fans_synced_at, last_attempt_at, last_status) values ($1, $2, $2, $2, 'ok')`,
      [creatorId, cut.toISOString()],
    );
    await pg.query("insert into of_dashboard_snapshot (creator_id, metric, taken_at, value) values ($1, 'online', $2, $3)", [creatorId, new Date(cut.getTime() + 90_000).toISOString(), Math.round(3 + random() * 20)]);
  }
  await pg.query("insert into of_dashboard_cut (cut_at, started_at, finished_at, accounts_read) values ($1, $1, $2, 3)", [cut.toISOString(), new Date(cut.getTime() + 5 * 60_000).toISOString()]);
  await pg.close();
  const store = new AccountStore(path.join(dir, "accounts.json"));
  await store.init();
  for (const [creatorId, name] of CREATORS) await store.create(name, creatorId);
  return total;
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
  return spawn(process.execPath, ["node_modules/vite/bin/vite.js", "dev", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], { cwd: root, env, stdio: "ignore" });
}

async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode != null) return;
  await new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
    child.kill("SIGTERM");
    setTimeout(resolve, 15_000);
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
  const deadline = Date.now() + 90_000;
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
