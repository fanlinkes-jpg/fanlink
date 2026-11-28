import assert from "node:assert/strict";
import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { chromium, type Page } from "playwright";
import { AccountStore } from "../store/account-store.ts";
import { assertDevPortFree, shotFile } from "../../../src/lib/dev-test-server.ts";

const root = path.resolve(import.meta.dirname, "../../..");
const PASSWORD = "contraseña-segura-1";
const SECRET = "SECRETO-TERCERA";

test("la dueña invita, el empleado acepta, entra con correo y contraseña y solo ve sus creadoras; desactivar le corta el acceso", async () => {
  const dir = path.join(tmpdir(), `fanlink-empleados-${Date.now()}`);
  await seed(dir);
  const port = await freePort();
  const server = await startDev(dir, port);
  const browser = await chromium.launch();
  try {
    const base = `http://127.0.0.1:${port}`;
    await waitForServer(`${base}/mensajes`);
    const owner = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
    owner.on("dialog", (dialog) => void dialog.accept());

    // 1. La dueña abre Personal > Empleados y añade a Marta con dos de tres creadoras.
    await owner.goto(`${base}/administrar?tab=empleados`, { waitUntil: "domcontentloaded" });
    await owner.getByTestId("employees-table").waitFor();
    await owner.getByRole("button", { name: "Añadir empleado" }).click();
    const dialog = owner.getByRole("dialog", { name: "Añadir empleado" });
    await dialog.getByLabel("Nombre").fill("Marta Ruiz");
    await dialog.getByLabel("Correo").fill("marta@example.com");
    await dialog.getByLabel("Rol").selectOption("chatter");
    assert.equal(await dialog.getByLabel("Rol").locator("option", { hasText: "Owner" }).count(), 0, "Owner no se puede asignar");
    await dialog.getByLabel("Alba").check();
    await dialog.getByLabel("Nora").check();
    await dialog.getByRole("button", { name: "Guardar e invitar" }).click();
    // Sin RESEND_API_KEY no falla: enseña el enlace para copiarlo.
    const delivery = owner.getByTestId("invite-delivery");
    await delivery.waitFor();
    assert.match(await delivery.innerText(), /no está configurado/);
    const link = await owner.getByTestId("invite-link").inputValue();
    assert.match(link, new RegExp(`^http://127\\.0\\.0\\.1:${port}/invitacion/[A-Za-z0-9_-]{40,}$`));
    await owner.getByRole("button", { name: "Listo" }).click();
    const row = owner.getByTestId("employee-row").filter({ hasText: "Marta Ruiz" });
    await row.waitFor();
    assert.match(await row.innerText(), /Invitado/);
    assert.match(await row.innerText(), /Alba/);
    assert.match(await row.innerText(), /Chatter/);
    assert.equal(await owner.getByTestId("employee-row").filter({ hasText: "Tercera" }).count(), 0);

    // Entrar sin invitación no da acceso: un enlace inventado no abre nada.
    const stranger = await (await browser.newContext()).newPage();
    await stranger.goto(`${base}/invitacion/token-inventado`, { waitUntil: "domcontentloaded" });
    await stranger.getByText("Este enlace de invitación no es válido.").waitFor();
    assert.equal(await stranger.getByRole("button", { name: /Aceptar invitación/ }).count(), 0);
    // El registro libre está cerrado aunque el origen sea de confianza.
    const signUp = await stranger.context().request.post(`${base}/api/auth/sign-up/email`, {
      headers: { origin: "http://127.0.0.1:8080" },
      data: { email: "intruso@example.com", password: "12345678abc", name: "Intruso" },
    });
    assert.equal(signUp.status(), 400, await signUp.text());
    assert.match(await signUp.text(), /sign up/i);
    await stranger.close();

    // 2. El empleado acepta, pone la contraseña y entra.
    const employeeContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const employee = await employeeContext.newPage();
    await employee.goto(link, { waitUntil: "domcontentloaded" });
    await employee.getByText("Hola, Marta Ruiz").waitFor();
    await employee.getByLabel("Contraseña", { exact: true }).fill(PASSWORD);
    await employee.getByLabel("Repite la contraseña").fill("otra-distinta-1");
    await employee.getByRole("button", { name: /Aceptar invitación/ }).click();
    await employee.getByText(/no coinciden/).waitFor();
    await employee.getByLabel("Contraseña", { exact: true }).fill(PASSWORD);
    await employee.getByLabel("Repite la contraseña").fill(PASSWORD);
    await employee.getByRole("button", { name: /Aceptar invitación/ }).click();
    await employee.waitForURL(`${base}/`, { timeout: 30_000 });

    await employee.goto(`${base}/mensajes`, { waitUntil: "domcontentloaded" });
    const column = employee.getByRole("complementary", { name: "Creadoras" });
    await column.getByRole("button", { name: /Alba/ }).waitFor({ timeout: 30_000 });
    await column.getByRole("button", { name: /Nora/ }).waitFor();
    assert.equal(await column.getByRole("button", { name: /Tercera/ }).count(), 0);
    assert.equal(await employee.getByRole("link", { name: "Personal" }).count(), 0);
    await employee.goto(`${base}/administrar`, { waitUntil: "domcontentloaded" });
    await employee.getByText("no tiene acceso a esta sección.").waitFor({ timeout: 15_000 });
    const status = (page: Page, url: string, body: unknown) =>
      page.evaluate(async ([target, payload]) => (await fetch(target as string, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) })).status, [url, body] as const);
    assert.equal(await status(employee, `${base}/api/vault-query`, { creatorId: "c-tercera" }), 403);
    await employee.screenshot({ path: shotFile("empleado-mensajes.png") });

    // 3. El enlace ya no vale una segunda vez.
    const again = await (await browser.newContext()).newPage();
    await again.goto(link, { waitUntil: "domcontentloaded" });
    await again.getByText("Esta invitación ya se usó.").waitFor();
    await again.close();

    // 4. La dueña lo ve como Activado.
    await owner.reload({ waitUntil: "domcontentloaded" });
    const activeRow = owner.getByTestId("employee-row").filter({ hasText: "Marta Ruiz" });
    await activeRow.waitFor();
    assert.match(await activeRow.innerText(), /Activado/);
    await owner.getByLabel("Filtrar por estado").selectOption("invited");
    assert.equal(await owner.getByTestId("employee-row").filter({ hasText: "Marta Ruiz" }).count(), 0);
    await owner.getByLabel("Filtrar por estado").selectOption("active");
    await activeRow.waitFor();
    await owner.getByLabel("Filtrar por creadora").selectOption("c-nora");
    await activeRow.waitFor();
    await owner.getByLabel("Filtrar por creadora").selectOption("c-tercera");
    await activeRow.waitFor({ state: "detached" });
    await owner.getByLabel("Filtrar por creadora").selectOption("todas");
    await owner.getByLabel("Filtrar por estado").selectOption("todos");
    await owner.screenshot({ path: shotFile("personal-empleados.png") });

    // 5. Login con correo y contraseña desde cero; con la contraseña mala no entra.
    const login = await (await browser.newContext()).newPage();
    await login.goto(`${base}/login`, { waitUntil: "networkidle" });
    await login.getByLabel("Correo").fill("marta@example.com");
    await login.getByLabel("Contraseña").fill("incorrecta-123");
    await login.getByRole("button", { name: "Entrar", exact: true }).click();
    await login.getByText("Correo o contraseña incorrectos.").waitFor();
    await login.getByLabel("Contraseña").fill(PASSWORD);
    await login.getByRole("button", { name: "Entrar", exact: true }).click();
    await login.waitForURL(`${base}/`, { timeout: 30_000 });
    await login.goto(`${base}/mensajes`, { waitUntil: "domcontentloaded" });
    await login.getByRole("complementary", { name: "Creadoras" }).getByRole("button", { name: /Alba/ }).waitFor({ timeout: 30_000 });
    await login.close();

    // 6. Desactivar corta la sesión al momento.
    assert.notEqual(await status(employee, `${base}/api/vault-query`, { creatorId: "c-alba" }), 401);
    await activeRow.getByRole("button", { name: "Más acciones de Marta Ruiz" }).click();
    await owner.getByRole("menuitem", { name: "Desactivar" }).click();
    await owner.getByTestId("employee-row").filter({ hasText: "Marta Ruiz" }).getByText("Desactivado").waitFor();
    assert.equal(await status(employee, `${base}/api/vault-query`, { creatorId: "c-alba" }), 401);
    const blocked = await (await browser.newContext()).request.post(`${base}/api/staff-login`, { data: { email: "marta@example.com", password: PASSWORD } });
    assert.equal(blocked.status(), 403);

    // 7. Activar la devuelve; eliminar la quita y sus envíos se quedan con el nombre.
    await activeRow.getByRole("button", { name: "Más acciones de Marta Ruiz" }).click();
    await owner.getByRole("menuitem", { name: "Activar" }).click();
    await owner.getByTestId("employee-row").filter({ hasText: "Marta Ruiz" }).getByText("Activado", { exact: true }).waitFor();
    assert.notEqual(await status(employee, `${base}/api/vault-query`, { creatorId: "c-alba" }), 401);
    await employee.close();
    await owner.close();
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
  const creators = [["c-alba", "Alba"], ["c-nora", "Nora"], ["c-tercera", "Tercera"]].map(([id, name], index) => ({
    id,
    name,
    handle: `@${name?.toLowerCase()}`,
    platform: "onlyfans",
    city: "España",
    subscribers: 10,
    revenue30: 987654,
    growth: 0,
    split: 25,
    status: "activa",
    hue: index * 40,
    proxy: "",
    staff: [],
  }));
  await pg.query(
    "insert into workspace_state (id, state, version, updated_by) values (1, $1::jsonb, 1, 'dueña')",
    [JSON.stringify({
      agency: "Fanlink",
      creators,
      fans: ["c-alba", "c-nora", "c-tercera"].map((creatorId) => ({ id: `f-${creatorId}`, creatorId, name: `Fan ${creatorId}`, handle: "fan", spendLife: 0, spend30: 0, days: 1, status: "activo", tier: "bronce", online: false, notes: creatorId === "c-tercera" ? SECRET : "", tags: [], city: "", unread: 0 })),
      messages: [],
      vault: [],
      scripts: [],
      lists: [],
      campaigns: [],
      employees: [],
      links: [],
      automations: [],
      history: [{ day: "2026-11-01", euros: 987654, label: "HISTORICO-AGENCIA" }],
      stopWords: [],
      copilot: true,
      translate: true,
      adaptPrices: true,
      notifyShifts: true,
    })],
  );
  // Quien abre sin cookie es el usuario local de siempre: la dueña.
  await pg.exec(`insert into workspace_member (user_id) values ('dev-user') on conflict do nothing`);
  await pg.exec(`insert into staff_profile (user_id, display_name, role, perms, level) values ('dev-user', 'Dueña', 'owner', '["mensajes","precios","vault","campanas","analitica","equipo","ajustes"]'::jsonb, 'owner')`);
  for (const [creatorId, unread] of [["c-alba", 3], ["c-nora", 2], ["c-tercera", 40]] as const) {
    await pg.query(
      `insert into of_chat_thread (creator_id, thread_key, fan_key, fan_name, last_message_at, excerpt, unread, synced_at, origin)
       values ($1, '1', '1', $2, now(), $3, $4, now(), 'onlyfans')`,
      [creatorId, `Fan ${creatorId}`, creatorId === "c-tercera" ? SECRET : "hola", unread],
    );
    await pg.query(
      `insert into of_chat_message (creator_id, message_key, thread_key, fan_key, from_fan, body, sent_at, synced_at, origin)
       values ($1, 'm1', '1', '1', true, $2, now(), now(), 'onlyfans')`,
      [creatorId, creatorId === "c-tercera" ? SECRET : "hola"],
    );
  }
  await pg.close();
  const store = new AccountStore(path.join(dir, "accounts.json"));
  await store.init();
  await store.create("Alba", "c-alba");
  await store.create("Nora", "c-nora");
  await store.create("Tercera", "c-tercera");
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
  // Sin proveedor de correo: el modal tiene que enseñar el enlace.
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
