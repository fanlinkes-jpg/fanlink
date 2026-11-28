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
const SECRET = "SECRETO-TERCERA";

test("un chatter con 2 de 3 creadoras no ve nada de la tercera: ni por URL directa, ni por id, ni en las respuestas del servidor", async () => {
  const dir = path.join(tmpdir(), `fanlink-chatter-${Date.now()}`);
  await seed(dir);
  const port = await freePort();
  const server = await startDev(dir, port);
  const browser = await chromium.launch();
  try {
    const base = `http://127.0.0.1:${port}`;
    await waitForServer(`${base}/mensajes`);
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const bodies: string[] = [];
    page.on("response", (response) => {
      const url = response.url();
      if (!url.startsWith(base) || /\.(js|css|svg|png|woff2?)(\?|$)/.test(url) || url.includes("/@") || url.includes("/node_modules/") || url.includes("/src/")) return;
      void response.text().then((text) => bodies.push(text)).catch(() => undefined);
    });

    await page.goto(`${base}/mensajes`, { waitUntil: "domcontentloaded" });
    const column = page.getByRole("complementary", { name: "Creadoras" });
    await column.getByRole("button", { name: /Alba/ }).waitFor();
    await column.getByRole("button", { name: /Nora/ }).waitFor();
    assert.equal(await column.getByRole("button", { name: /Tercera/ }).count(), 0);
    // La burbuja del menú suma 3 + 2 y no los 40 de la tercera.
    await page.getByRole("link", { name: "Chat, 5 sin leer" }).waitFor();
    assert.equal(await page.getByRole("link", { name: /Chat, 45/ }).count(), 0);
    assert.equal(await page.getByText(SECRET).count(), 0);

    // Por URL directa y por id: la bandeja cae en una cuenta asignada.
    for (const url of [`${base}/mensajes?creator=c-tercera`, `${base}/mensajes?creatorId=c-tercera`, `${base}/mensajes/c-tercera`]) {
      await page.goto(url, { waitUntil: "domcontentloaded" });
      await page.getByRole("complementary", { name: "Creadoras" }).getByRole("button", { name: /Alba/ }).waitFor().catch(() => undefined);
      assert.equal(await page.getByText(SECRET).count(), 0, url);
      assert.equal(await page.getByRole("button", { name: /Tercera/ }).count(), 0, url);
    }

    // Operaciones y las secciones de agencia no existen para un chatter, ni por URL.
    await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
    await page.getByRole("link", { name: "Dashboard" }).waitFor();
    assert.equal(await page.getByRole("link", { name: "Operaciones" }).count(), 0);
    assert.equal(await page.getByRole("link", { name: "Personal" }).count(), 0);
    assert.equal(await page.getByRole("link", { name: "Configuración" }).count(), 0);
    for (const route of ["/notificaciones", "/administrar", "/ajustes"]) {
      await page.goto(`${base}${route}`, { waitUntil: "domcontentloaded" });
      await page.getByText("no tiene acceso a esta sección.").waitFor({ timeout: 15_000 }).catch(async () => {
        throw new Error(`${route} abrió ${page.url()}: ${(await page.locator("body").innerText()).slice(0, 300)}`);
      });
    }
    // Los informes de la agencia tampoco: el dashboard solo ofrece Alba y Nora y avisa de que no hay acceso.
    await page.goto(`${base}/analitica`, { waitUntil: "domcontentloaded" });
    await page.getByText("No tienes acceso a los informes.").waitFor();
    assert.equal(await page.getByText(/Tercera/).count(), 0);
    await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
    await page.getByRole("link", { name: "Dashboard" }).waitFor();
    assert.equal(await page.getByText(/Tercera/).count(), 0);
    await page.screenshot({ path: shotFile("chatter-dashboard.png") });

    // Por id, a mano contra las rutas /api con la sesión del chatter.
    const status = (url: string, init?: RequestInit) => page.evaluate(async ([target, options]) => (await fetch(target as string, options as RequestInit)).status, [url, init ?? {}] as const);
    assert.equal(await status(`${base}/api/vault-query`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ creatorId: "c-tercera" }) }), 403);
    assert.equal(await status(`${base}/api/chat-media?creatorId=c-tercera&threadKey=1&messageKey=m1&index=0`), 403);
    assert.equal(await status(`${base}/api/vault-media?creatorId=c-tercera&mediaId=1`), 403);
    assert.equal(await status(`${base}/api/vault-media?creatorId=c-tercera&mediaId=1&variant=hls&k=x&s=y`), 403);
    assert.equal(await status(`${base}/api/vault-send`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ creatorId: "c-tercera", itemIds: ["1"] }) }), 403);
    assert.equal(await status(`${base}/api/vault-send`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "mass", accountId: "x" }) }), 403);
    // Control positivo: con una cuenta asignada la ruta no es un 403.
    assert.notEqual(await status(`${base}/api/chat-media?creatorId=c-alba&threadKey=1&messageKey=m1&index=0`), 403);

    // Nada de la tercera ni de la agencia viaja en las respuestas del servidor.
    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.ok(bodies.some((body) => body.includes("c-alba")), "no se capturó ninguna respuesta con datos");
    for (const forbidden of ["c-tercera", "Tercera", SECRET, "987654", "HISTORICO-AGENCIA"]) {
      const leaking = bodies.find((body) => body.includes(forbidden));
      assert.equal(leaking, undefined, `la respuesta del servidor lleva «${forbidden}»: ${leaking?.slice(Math.max(0, (leaking?.indexOf(forbidden) ?? 0) - 150), (leaking?.indexOf(forbidden) ?? 0) + 150)}`);
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
  // La persona de prueba es un miembro con permiso de mensajes y solo dos cuentas asignadas.
  await pg.exec(`insert into workspace_member (user_id) values ('dev-user') on conflict do nothing`);
  await pg.exec(`insert into staff_profile (user_id, display_name, role, perms) values ('dev-user', 'Chatter de prueba', 'member', '["mensajes","vault"]'::jsonb)`);
  await pg.exec(`insert into creator_grant (user_id, creator_id) values ('dev-user', 'c-alba'), ('dev-user', 'c-nora')`);
  await pg.exec(`insert into staff_profile (user_id, display_name, role, perms) values ('dueña', 'Dueña', 'owner', '[]'::jsonb)`);
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
