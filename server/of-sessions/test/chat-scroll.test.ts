import assert from "node:assert/strict";
import { mkdir, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { chromium, type Page } from "playwright";
import { AccountStore } from "../store/account-store.ts";

const root = path.resolve(import.meta.dirname, "../../..");
const port = 18742;
const TOTAL = 150;

type Gap = { gap: number; scrollHeight: number; clientHeight: number; pageScroll: number; last: boolean };

async function gap(page: Page, lastKey = "m149"): Promise<Gap> {
  return page.evaluate((key) => {
    const list = document.querySelector("ol[data-thread-scroll]") as HTMLElement | null;
    if (!list) return { gap: -1, scrollHeight: 0, clientHeight: 0, pageScroll: 0, last: false };
    const rect = list.getBoundingClientRect();
    const lastRow = list.querySelector(`[data-message-id='${key}']`) as HTMLElement | null;
    const lastRect = lastRow?.getBoundingClientRect();
    return {
      gap: Math.round(list.scrollHeight - list.scrollTop - list.clientHeight),
      scrollHeight: list.scrollHeight,
      clientHeight: list.clientHeight,
      pageScroll: document.scrollingElement?.scrollTop ?? 0,
      last: lastRect != null && lastRect.bottom <= rect.bottom + 2 && lastRect.top >= rect.top,
    };
  }, lastKey);
}

async function assertAtBottom(page: Page, lastKey: string, what: string): Promise<void> {
  const samples: Gap[] = [];
  for (const wait of [50, 400, 1200, 2500]) {
    await page.waitForTimeout(wait);
    samples.push(await gap(page, lastKey));
  }
  const label = `${what}: ${JSON.stringify(samples)}`;
  for (const sample of samples) {
    assert.ok(sample.scrollHeight > sample.clientHeight, `la lista no es la que hace scroll: ${label}`);
    assert.equal(sample.pageScroll, 0, `hace scroll la página: ${label}`);
    assert.ok(sample.gap >= 0 && sample.gap <= 4, `no está abajo del todo: ${label}`);
    assert.equal(sample.last, true, `el último mensaje no se ve entero: ${label}`);
  }
}

test("al abrir un chat largo con medios, la conversación queda en el último mensaje sin hacer scroll", async () => {
  const dir = path.join(tmpdir(), `fanlink-scroll-${Date.now()}`);
  await seed(dir);
  const server = startDev(dir);
  const browser = await chromium.launch();
  try {
    await waitForServer(`http://127.0.0.1:${port}/mensajes`);
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(`http://127.0.0.1:${port}/mensajes`, { waitUntil: "domcontentloaded" });
    // Con scroll suave global la bajada no se corta a medias.
    await page.addStyleTag({ content: "html, body, * { scroll-behavior: smooth !important; }" });
    await page.getByRole("button", { name: /Fan Uno/ }).click();
    await page.locator("ol[data-thread-scroll] [data-message-id='m149']").waitFor({ timeout: 60_000 });
    await assertAtBottom(page, "m149", "primer chat");
    // Cambiar a otro chat desde uno largo: el nuevo también abre en su último mensaje.
    await page.getByRole("button", { name: /Fan Dos/ }).click();
    await page.locator("ol[data-thread-scroll] [data-message-id='n149']").waitFor({ timeout: 60_000 });
    await assertAtBottom(page, "n149", "segundo chat");
    // Si algo encoge la lista (un aviso que aparece encima), sigue abajo.
    await page.locator("ol[data-thread-scroll]").evaluate((list) => {
      const bar = document.createElement("div");
      bar.style.cssText = "height:140px;flex:none";
      list.parentElement?.parentElement?.insertBefore(bar, list.parentElement);
    });
    await assertAtBottom(page, "n149", "tras encoger la lista");
    await page.getByRole("button", { name: /Fan Uno/ }).click();
    await page.locator("ol[data-thread-scroll] [data-message-id='m149']").waitFor({ timeout: 60_000 });
    await assertAtBottom(page, "m149", "volver al primero");
    // Subir un píxel con la rueda mientras el chat acaba de abrirse: ningún reintento la devuelve abajo.
    await page.getByRole("button", { name: /Fan Dos/ }).click();
    await page.locator("ol[data-thread-scroll] [data-message-id='n149']").waitFor({ timeout: 60_000 });
    const listBox = await page.locator("ol[data-thread-scroll]").boundingBox();
    await page.mouse.move((listBox?.x ?? 0) + (listBox?.width ?? 0) / 2, (listBox?.y ?? 0) + (listBox?.height ?? 0) / 2);
    await page.mouse.wheel(0, -3);
    const held: number[] = [];
    for (let index = 0; index < 12; index += 1) {
      await page.waitForTimeout(300);
      held.push((await gap(page, "n149")).gap);
    }
    assert.ok(held[0] >= 2, `no subió: ${JSON.stringify(held)}`);
    for (const value of held) assert.ok(value >= held[0] - 1, `tiró hacia abajo tras subir: ${JSON.stringify(held)}`);
    // Si la persona sube, no se la arrastra de vuelta.
    const box = await page.locator("ol[data-thread-scroll]").boundingBox();
    await page.mouse.move((box?.x ?? 0) + (box?.width ?? 0) / 2, (box?.y ?? 0) + (box?.height ?? 0) / 2);
    await page.mouse.wheel(0, -2500);
    await page.waitForTimeout(1200);
    const up = await gap(page);
    assert.ok(up.gap > 200, `se volvió a bajar solo tras subir: ${JSON.stringify(up)}`);
    await page.close();
  } finally {
    await browser.close().catch(() => undefined);
    server.kill("SIGTERM");
  }
});

test("al fijar un chat sube arriba al instante con su pin, y al quitarlo vuelve a su sitio; la estrella se ve en la fila", async () => {
  const dir = path.join(tmpdir(), `fanlink-pin-${Date.now()}`);
  await seed(dir);
  const server = startDev(dir);
  const browser = await chromium.launch();
  try {
    await waitForServer(`http://127.0.0.1:${port}/mensajes`);
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(`http://127.0.0.1:${port}/mensajes`, { waitUntil: "domcontentloaded" });
    const rows = () => page.locator("section ul li button").filter({ hasText: /Fan (Uno|Dos)/ });
    await rows().first().waitFor({ timeout: 60_000 });
    assert.match((await rows().first().innerText()), /Fan Dos/, "por mensaje reciente, Fan Dos va primero");
    await page.getByRole("button", { name: /Fan Uno/ }).click();
    await page.getByRole("button", { name: "Fijar chat" }).click();
    await page.waitForFunction(() => /Fan Uno/.test(document.querySelector("section ul li button")?.textContent ?? ""), null, { timeout: 3000 });
    assert.equal(await rows().first().locator("[aria-label='Fijado']").count(), 1, "la fila lleva el icono de pin");
    await page.getByRole("button", { name: "Favorito" }).click();
    await page.waitForTimeout(1500);
    assert.equal(await rows().first().locator("[aria-label='Favorito']").count(), 1, "la fila lleva la estrella");
    // Pasado el refresco con el servidor, sigue arriba.
    await page.getByRole("button", { name: "Recargar" }).click();
    await page.waitForTimeout(1500);
    assert.match((await rows().first().innerText()), /Fan Uno/);
    await page.getByRole("button", { name: "Desfijar chat" }).click();
    await page.waitForFunction(() => /Fan Dos/.test(document.querySelector("section ul li button")?.textContent ?? ""), null, { timeout: 3000 });
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
  await pg.exec(`insert into of_chat_thread (
    creator_id, thread_key, fan_key, fan_name, fan_handle, last_message_at, excerpt, unread, synced_at, origin, last_from_fan
  ) values (
    'cpreview', '7', '7', 'Fan Uno', 'fanuno', '2026-11-20T12:00:00Z', 'fin', 0, now(), 'onlyfans', true
  )`);
  await pg.exec(`insert into of_chat_thread (
    creator_id, thread_key, fan_key, fan_name, fan_handle, last_message_at, excerpt, unread, synced_at, origin, last_from_fan
  ) values (
    'cpreview', '8', '8', 'Fan Dos', 'fandos', '2026-11-21T12:00:00Z', 'fin', 3, now(), 'onlyfans', true
  )`);
  for (const [thread, prefix] of [["7", "m"], ["8", "n"]] as const) for (let index = 0; index < TOTAL; index += 1) {
    const sentAt = new Date(Date.UTC(2026, 10, 1) + index * 3 * 3600 * 1000).toISOString();
    const withMedia = index % 5 === 0;
    const media = withMedia
      ? JSON.stringify([
        { kind: "foto", seconds: null, preview: "https://cdn.example/a.jpg", locked: false, priceCents: 1500, paid: false, opened: false },
        { kind: "video", seconds: 31, preview: "https://cdn.example/b.jpg", locked: true, priceCents: 1500, paid: false, opened: false },
      ])
      : null;
    await pg.query(
      `insert into of_chat_message (
         creator_id, message_key, thread_key, fan_key, from_fan, body, sent_at, price_cents, purchased, synced_at, origin,
         seen, media_count, media_json
       ) values ('cpreview', $1, '${thread}', '${thread}', $2, $3, $4, $5, $6, now(), 'onlyfans', $7, $8, $9)`,
      [
        `${prefix}${index}`,
        index % 2 === 1,
        withMedia ? `Título ${index}\nPárrafo uno del mensaje ${index}\nPárrafo dos` : `Mensaje de prueba número ${index} con algo de texto para ocupar una línea o dos en pantalla`,
        sentAt,
        withMedia ? 1500 : null,
        withMedia ? false : null,
        index % 2 === 0 ? true : null,
        withMedia ? 2 : null,
        media,
      ],
    );
  }
  await pg.close();
  const store = new AccountStore(path.join(dir, "accounts.json"));
  await store.init();
  await store.create("Preview", "cpreview");
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
