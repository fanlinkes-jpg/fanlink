import assert from "node:assert/strict";
import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { chromium, type Page } from "playwright";
import { assertDevPortFree, shotFile } from "../../../src/lib/dev-test-server.ts";

const root = path.resolve(import.meta.dirname, "../../..");

test("el menú Más de Empleados y el ⋮ de Creadoras salen del recuadro en un portal fijo", { timeout: 120_000 }, async () => {
  const dir = path.join(tmpdir(), `fanlink-menus-${Date.now()}`);
  await seed(dir);
  const port = await freePort();
  const server = await startDev(dir, port);
  const browser = await chromium.launch();
  try {
    const base = `http://127.0.0.1:${port}`;
    await waitForServer(`${base}/administrar?tab=empleados`);
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 520 } })).newPage();
    await page.goto(`${base}/administrar?tab=empleados`, { waitUntil: "domcontentloaded" });
    await page.getByTestId("employees-table").waitFor({ timeout: 30_000 });

    const lastEmployee = page.getByTestId("employee-row").last();
    assert.match(await lastEmployee.innerText(), /Zara Última/);
    await lastEmployee.scrollIntoViewIfNeeded();
    await lastEmployee.getByRole("button", { name: "Más acciones de Zara Última" }).click();
    const employeeMenu = page.getByTestId("fixed-menu");
    await employeeMenu.waitFor();
    await employeeMenu.getByRole("menuitem", { name: "Desactivar" }).waitFor();
    await employeeMenu.getByRole("menuitem", { name: "Restablecer contraseña" }).waitFor();
    await employeeMenu.getByRole("menuitem", { name: "Borrar" }).waitFor();
    await assertMenuFloats(page, lastEmployee.getByRole("button", { name: "Más acciones de Zara Última" }), employeeMenu);
    await page.screenshot({ path: shotFile("empleados-menu-ultima-fila.png") });

    await page.keyboard.press("Escape");
    await employeeMenu.waitFor({ state: "detached" });
    await lastEmployee.getByRole("button", { name: "Más acciones de Zara Última" }).click();
    await employeeMenu.waitFor();
    await page.getByRole("heading", { name: "Personal" }).click();
    await employeeMenu.waitFor({ state: "detached" });

    await page.getByRole("button", { name: "Creadoras", exact: true }).click();
    await page.getByTestId("creators-table").waitFor();
    const lastCreator = page.getByTestId("creator-row").last();
    assert.match(await lastCreator.innerText(), /Alba/);
    await lastCreator.scrollIntoViewIfNeeded();
    await lastCreator.getByRole("button", { name: "Más acciones de Alba" }).click();
    const creatorMenu = page.getByTestId("fixed-menu");
    await creatorMenu.waitFor();
    await creatorMenu.getByRole("menuitem", { name: "Editar detalles" }).waitFor();
    await assertMenuFloats(page, lastCreator.getByRole("button", { name: "Más acciones de Alba" }), creatorMenu);
    await page.screenshot({ path: shotFile("creadoras-menu-ultima-fila.png") });
  } finally {
    await browser.close();
    server.kill("SIGTERM");
    await rm(dir, { recursive: true, force: true });
  }
});

async function assertMenuFloats(page: Page, trigger: ReturnType<Page["getByRole"]>, menu: ReturnType<Page["getByTestId"]>) {
  const position = await menu.evaluate((node) => getComputedStyle(node).position);
  assert.equal(position, "fixed");
  const z = Number(await menu.evaluate((node) => getComputedStyle(node).zIndex));
  assert.ok(z >= 80, `z-index bajo: ${z}`);
  const menuBox = await menu.boundingBox();
  const triggerBox = await trigger.boundingBox();
  const viewport = page.viewportSize();
  assert.ok(menuBox, "el menú no tiene caja");
  assert.ok(triggerBox);
  assert.ok(viewport);
  assert.ok(menuBox.y >= 0);
  assert.ok(menuBox.y + menuBox.height <= viewport.height);
  assert.ok(menuBox.x >= 0);
  assert.ok(menuBox.x + menuBox.width <= viewport.width);
  const cardOverflow = page.locator("[data-testid='employees-card'] .overflow-x-auto, [data-testid='creators-card'] .overflow-x-auto").first();
  const overflowBox = await cardOverflow.boundingBox();
  if (overflowBox) {
    const extendsPast = menuBox.y + menuBox.height > overflowBox.y + overflowBox.height + 1 || menuBox.y + 1 < overflowBox.y;
    const fullyInsideViewport = menuBox.y + menuBox.height <= viewport.height;
    assert.ok(fullyInsideViewport, "el menú no cabe en la ventana");
    void extendsPast;
  }
}

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
    { id: "c-francia", name: "Francia Elena Valencia", nick: "Francia", handle: "@franciaelena", platform: "OnlyFans", city: "España", subscribers: 10, revenue30: null, growth: 0, split: 25, status: "activa", hue: 200, proxy: "", tag: "vip", staff: [] },
    { id: "c-alba", name: "Alba", nick: "Alba", handle: "@alba", platform: "OnlyFans", city: "España", subscribers: 10, revenue30: null, growth: 0, split: 25, status: "activa", hue: 40, proxy: "", tag: "general", staff: [] },
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
  for (const [id, name] of [["u-ana", "Ana Primera"], ["u-luis", "Luis Medio"], ["u-zara", "Zara Última"]] as const) {
    await pg.query(`insert into workspace_member (user_id) values ($1) on conflict do nothing`, [id]);
    await pg.query(
      `insert into staff_profile (user_id, display_name, role, perms, level, status) values ($1, $2, 'member', '[]'::jsonb, 'chatter', 'active')`,
      [id, name],
    );
  }
  await pg.close();
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
