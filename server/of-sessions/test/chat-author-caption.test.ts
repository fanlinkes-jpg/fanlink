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
const LONG = "Alejandra Fernández de la Vega Montenegro-Quiroga";

test("el nombre del chatter va debajo de la burbuja con la hora y el doble check, en azul y con elipsis", async () => {
  const dir = path.join(tmpdir(), `fanlink-autor-${Date.now()}`);
  await seed(dir);
  const port = await freePort();
  const server = await startDev(dir, port);
  const browser = await chromium.launch();
  try {
    const base = `http://127.0.0.1:${port}`;
    await waitForServer(`${base}/mensajes`);
    const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
    await page.goto(`${base}/mensajes`, { waitUntil: "domcontentloaded" });
    await page.locator("main ul button").first().click();
    await page.locator('[data-message-id="m-marta"]').waitFor({ timeout: 60_000 });

    const marta = page.locator('[data-message-id="m-marta"]');
    const caption = marta.getByTestId("message-caption");
    await caption.waitFor();
    const bubble = marta.locator("div.rounded-\\[22px\\]");
    const bubbleBox = (await bubble.boundingBox())!;
    const captionBox = (await caption.boundingBox())!;
    assert.ok(captionBox.y >= bubbleBox.y + bubbleBox.height - 1, "la línea está debajo de la burbuja, no dentro");
    assert.equal(await bubble.getByText("Marta Ruiz").count(), 0, "el nombre no se repite dentro de la burbuja");
    const author = caption.getByTestId("message-author");
    assert.equal(await author.innerText(), "Marta Ruiz");
    assert.equal(await author.evaluate((node) => getComputedStyle(node).color), "rgb(29, 155, 240)");
    // Orden: hora, doble check gris, nombre.
    const order = await caption.evaluate((node) => Array.from(node.children).map((child) => child.tagName.toLowerCase() === "svg" ? "check" : child.getAttribute("data-testid") ?? "hora"));
    assert.deepEqual(order, ["hora", "check", "message-author"]);
    assert.match(await caption.locator("span").first().innerText(), /^\d{1,2}:\d{2}/);
    const check = caption.locator("svg");
    assert.equal(await check.getAttribute("aria-label"), "Enviado");
    assert.equal(await check.evaluate((node) => getComputedStyle(node).color), "rgb(154, 163, 178)");

    // Nombre largo: elipsis, sin romper la línea.
    const long = page.locator('[data-message-id="m-larga"]').getByTestId("message-author");
    await long.waitFor();
    const clipped = await long.evaluate((node) => ({ overflow: getComputedStyle(node).textOverflow, clipped: node.scrollWidth > node.clientWidth, title: node.getAttribute("title") }));
    assert.deepEqual(clipped, { overflow: "ellipsis", clipped: true, title: LONG });

    // Leído: el doble check pasa a azul.
    const read = page.locator('[data-message-id="m-leida"]').getByTestId("message-caption").locator("svg");
    assert.equal(await read.getAttribute("aria-label"), "Leído");

    // Sin autor: se queda el texto de siempre dentro de la burbuja.
    const plain = page.locator('[data-message-id="m-sin-autor"]');
    await plain.waitFor();
    assert.equal(await plain.getByTestId("message-caption").count(), 0);
    assert.match(await plain.locator("div.rounded-\\[22px\\]").innerText(), /Cuenta/);
    // Un mensaje del fan no lleva autor.
    assert.equal(await page.locator('[data-message-id="m-fan"]').getByTestId("message-caption").count(), 0);
    await page.screenshot({ path: shotFile("chat-autor-debajo.png") });
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
  for (const name of (await readdir(folder)).filter((file) => file.endsWith(".sql")).sort()) {
    await pg.exec(await readFile(path.join(folder, name), "utf8"));
    await pg.query("insert into _migrations (name) values ($1) on conflict do nothing", [name]);
  }
  const creator = { id: "c-alba", name: "Alba", handle: "@alba", platform: "onlyfans", city: "España", subscribers: 10, revenue30: 1, growth: 0, split: 25, status: "activa", hue: 0, proxy: "", staff: [] };
  await pg.query(
    "insert into workspace_state (id, state, version, updated_by) values (1, $1::jsonb, 1, 'dev-user')",
    [JSON.stringify({ agency: "Fanlink", creators: [creator], fans: [], messages: [], vault: [], scripts: [], lists: [], campaigns: [], employees: [], links: [], automations: [], history: [], stopWords: [], copilot: true, translate: true, adaptPrices: true, notifyShifts: true })],
  );
  await pg.exec(`insert into workspace_member (user_id) values ('dev-user') on conflict do nothing`);
  await pg.exec(`insert into staff_profile (user_id, display_name, role, perms, level) values ('dev-user', 'Dueña', 'owner', '["mensajes"]'::jsonb, 'owner')`);
  await pg.query(
    `insert into of_chat_thread (creator_id, thread_key, fan_key, fan_name, last_message_at, excerpt, unread, synced_at, origin)
     values ('c-alba', '1', '1', 'Fan uno', now(), 'hola', 0, now(), 'onlyfans')`,
  );
  // author_id null y author_name guardado: es lo que queda cuando se borra a la persona.
  const rows: Array<[string, boolean, string, string | null, boolean | null, number]> = [
    ["m-fan", true, "Hola guapa", null, null, 50],
    ["m-marta", false, "Buenas, ¿qué tal el día?", "Marta Ruiz", false, 40],
    ["m-larga", false, "Te cuento un secreto", LONG, false, 30],
    ["m-leida", false, "¿Sigues por ahí?", "Marta Ruiz", true, 20],
    ["m-sin-autor", false, "Mensaje sin autor", null, false, 10],
  ];
  for (const [key, fromFan, body, authorName, seen, minutes] of rows) {
    await pg.query(
      `insert into of_chat_message (creator_id, message_key, thread_key, fan_key, from_fan, body, sent_at, synced_at, origin, author_name, seen)
       values ('c-alba', $1, '1', '1', $2, $3, now() - ($4 || ' minutes')::interval, now(), 'onlyfans', $5, $6)`,
      [key, fromFan, body, String(minutes), authorName, seen],
    );
  }
  await pg.close();
  const store = new AccountStore(path.join(dir, "accounts.json"));
  await store.init();
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
