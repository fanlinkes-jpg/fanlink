import assert from "node:assert/strict";
import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "path";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { chromium } from "playwright";
import { AccountStore } from "../store/account-store.ts";
import { assertDevPortFree, shotFile } from "../../../src/lib/dev-test-server.ts";

const root = path.resolve(import.meta.dirname, "../../..");

test("Personal › Creadoras: tabla estilo Infloww, empleados de creator_grant y modal de edición", { timeout: 120_000 }, async () => {
  const dir = path.join(tmpdir(), `fanlink-creadoras-${Date.now()}`);
  await seed(dir);
  const port = await freePort();
  const server = await startDev(dir, port);
  const browser = await chromium.launch();
  try {
    const base = `http://127.0.0.1:${port}`;
    await waitForServer(`${base}/administrar?tab=creadoras`);
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
    await page.goto(`${base}/administrar?tab=creadoras`, { waitUntil: "domcontentloaded" });
    await page.getByTestId("creators-table").waitFor({ timeout: 30_000 });

    const filters = page.getByTestId("creator-filters");
    for (const label of ["Nombre del creador", "Plataforma", "Etiqueta", "Estado de conectividad", "Empleado", "Estado de la cuenta"]) {
      await filters.getByLabel(label, { exact: true }).waitFor();
    }
    for (const header of ["Creador", "Apodo", "Etiqueta", "Cuenta", "ID del Creador", "Empleados", "Estado de conectividad", "Última sincronización", "Ventas de hoy", "Acción"]) {
      await page.getByRole("columnheader", { name: header, exact: true }).waitFor();
    }

    const francia = page.getByTestId("creator-row").filter({ hasText: "Francia Elena Valencia" });
    await francia.waitFor();
    const franciaText = await francia.innerText();
    assert.match(franciaText, /Jose/);
    assert.match(franciaText, /Allison Miller/);
    assert.match(franciaText, /Baby Rabbit/);
    assert.doesNotMatch(franciaText, /Sin asignar/);
    assert.doesNotMatch(franciaText, /página cambiada/);
    assert.doesNotMatch(franciaText, /sin datos todavía/);
    assert.match(franciaText, /Sin datos/);
    assert.equal(await francia.getByRole("button", { name: "Reconectar" }).count(), 0);
    assert.equal(await francia.getByRole("button", { name: "Comprobar" }).count(), 0);

    const alba = page.getByTestId("creator-row").filter({ hasText: "Alba" });
    await alba.waitFor();
    assert.match(await alba.innerText(), /Sin asignar/);

    await page.getByTestId("creators-card").screenshot({ path: shotFile("creadoras-tabla.png") });

    await francia.getByTestId("creator-employees").click();
    const dialog = page.getByRole("dialog", { name: "Editar detalles de la cuenta" });
    await dialog.waitFor();
    const chips = dialog.getByTestId("assignee-chips");
    await chips.getByText("Jose").waitFor();
    await chips.getByText("Allison Miller").waitFor();
    await chips.getByText("Baby Rabbit").waitFor();
    await dialog.getByRole("button", { name: "Quitar a Baby Rabbit" }).click();
    await dialog.getByRole("button", { name: "Guardar", exact: true }).click();
    await dialog.waitFor({ state: "detached", timeout: 15_000 });
    const after = await francia.innerText();
    assert.match(after, /Jose/);
    assert.match(after, /Allison Miller/);
    assert.doesNotMatch(after, /Baby Rabbit/);

    await francia.getByRole("button", { name: "Editar Francia Elena Valencia" }).click();
    await dialog.waitFor();
    await dialog.screenshot({ path: shotFile("creadoras-modal.png") });
    await dialog.getByRole("button", { name: "Cancelar" }).click();
  } finally {
    await browser.close();
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
  const creators = [
    {
      id: "c-francia",
      name: "Francia Elena Valencia",
      nick: "Francia 💎",
      handle: "@franciaelena",
      platform: "OnlyFans",
      city: "España",
      subscribers: 10,
      revenue30: null,
      growth: 0,
      split: 25,
      status: "activa",
      hue: 200,
      proxy: "",
      tag: "vip",
      staff: [],
    },
    {
      id: "c-alba",
      name: "Alba",
      nick: "Alba",
      handle: "@alba",
      platform: "OnlyFans",
      city: "España",
      subscribers: 10,
      revenue30: null,
      growth: 0,
      split: 25,
      status: "activa",
      hue: 40,
      proxy: "",
      tag: "general",
      staff: [],
    },
  ];
  await pg.query(
    "insert into workspace_state (id, state, version, updated_by) values (1, $1::jsonb, 1, 'dueña')",
    [JSON.stringify({
      agency: "Fanlink Management",
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
  await pg.exec(`insert into workspace_member (user_id) values ('dev-user') on conflict do nothing`);
  await pg.exec(`insert into staff_profile (user_id, display_name, role, perms, level) values ('dev-user', 'Dueña', 'owner', '["mensajes","precios","vault","campanas","analitica","equipo","ajustes"]'::jsonb, 'owner')`);
  for (const [id, name] of [["u-jose", "Jose"], ["u-allison", "Allison Miller"], ["u-rabbit", "Baby Rabbit"]] as const) {
    await pg.query(
      `insert into workspace_member (user_id) values ($1) on conflict do nothing`,
      [id],
    );
    await pg.query(
      `insert into staff_profile (user_id, display_name, role, perms, level, status) values ($1, $2, 'member', '[]'::jsonb, 'chatter', 'active')`,
      [id, name],
    );
    await pg.query(`insert into creator_grant (user_id, creator_id) values ($1, 'c-francia')`, [id]);
  }
  await pg.close();
  const store = new AccountStore(path.join(dir, "accounts.json"));
  await store.init();
  await store.create("Francia Elena Valencia", "c-francia");
  await store.create("Alba", "c-alba");
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
  delete env.RESEND_API_KEY;
  delete env.FANLINK_MAIL_FROM;
  delete env.BETTER_AUTH_URL;
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
  const deadline = Date.now() + 60_000;
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
