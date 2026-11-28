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
const port = 18743;

/**
 * Translator y LanguageDetector falsos con la forma de los de Chrome. El paquete en>es hay que descargarlo, y
 * solo se deja crear durante un clic (como exige Chrome); la descarga emite progreso.
 */
const MOCK = `
  window.__packs = new Set(["es>en"]);
  window.__gesture = false;
  window.__created = [];
  document.addEventListener("click", (event) => { if (event.target && event.target.closest && event.target.closest("[role=switch]")) return; window.__gesture = true; setTimeout(() => { window.__gesture = false; }, 0); }, true);
  Object.defineProperty(navigator, "userActivation", { get: () => ({ isActive: window.__gesture }) });
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  window.Translator = {
    availability: async ({ sourceLanguage, targetLanguage }) => window.__packs.has(sourceLanguage + ">" + targetLanguage) ? "available" : "downloadable",
    create: async ({ sourceLanguage, targetLanguage, monitor }) => {
      const key = sourceLanguage + ">" + targetLanguage;
      if (!window.__packs.has(key)) {
        if (!window.__gesture) { const error = new Error("needs gesture"); error.name = "NotAllowedError"; throw error; }
        const listeners = [];
        monitor && monitor({ addEventListener: (_t, l) => listeners.push(l) });
        for (const loaded of [0.3, 0.7, 1]) { listeners.forEach((l) => l({ loaded })); await wait(250); }
        window.__packs.add(key);
      }
      window.__created.push(key);
      return { translate: async (text) => "[" + targetLanguage + "] " + text };
    },
  };
  window.LanguageDetector = {
    availability: async () => "available",
    create: async () => ({ detect: async (text) => [{ detectedLanguage: /\\b(hello|you|miss|the|how)\\b/i.test(text) ? "en" : "es", confidence: 0.95 }] }),
  };
`;

test("traductor: automática, icono por mensaje, descarga con clic y compositor sin envío", async () => {
  const dir = path.join(tmpdir(), `fanlink-translate-${Date.now()}`);
  await seed(dir);
  const server = startDev(dir);
  const browser = await chromium.launch();
  try {
    await waitForServer(`http://127.0.0.1:${port}/mensajes`);
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.addInitScript(MOCK);
    await page.goto(`http://127.0.0.1:${port}/mensajes`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: /Fan Uno/ }).click();
    const fanMessage = page.locator("[data-message-id='f1']");
    await fanMessage.waitFor({ timeout: 60_000 });
    assert.equal(await page.locator("[data-translated]").count(), 0, "sin traducción automática no se traduce nada");
    assert.equal(await fanMessage.getByRole("button", { name: "Traducir mensaje" }).count(), 1, "el mensaje del fan lleva el icono");
    assert.equal(await page.locator("[data-message-id='c0']").getByRole("button", { name: "Traducir mensaje" }).count(), 0, "los del equipo no");

    // Automática: el par EN→ES hay que bajarlo y el efecto no tiene gesto, así que sale el botón Descargar.
    await page.getByRole("switch", { name: "Traducción automática" }).click();
    const download = fanMessage.getByRole("button", { name: "Descargar" });
    await download.waitFor();
    assert.match(await fanMessage.innerText(), /Falta el paquete de idioma EN → ES/);
    await download.click();
    await fanMessage.getByText(/Descargando \d+ %/).waitFor();
    await fanMessage.locator("[data-translated]").waitFor({ timeout: 10_000 });
    assert.match(await fanMessage.locator("[data-translated]").innerText(), /\[es\] Hello, how are you today\?/);
    assert.match(await fanMessage.innerText(), /Hello, how are you today\?/, "el original sigue ahí");
    assert.equal(await page.locator("[data-message-id='f3'] [data-translated]").count(), 1, "los demás mensajes del fan también");

    // El icono oculta y vuelve a mostrar la traducción de un mensaje.
    await page.locator("[data-message-id='f3']").getByRole("button", { name: "Traducir mensaje" }).click();
    assert.equal(await page.locator("[data-message-id='f3'] [data-translated]").count(), 0);
    await page.locator("[data-message-id='f3']").getByRole("button", { name: "Traducir mensaje" }).click();
    await page.locator("[data-message-id='f3'] [data-translated]").waitFor();

    // En lugar del original, con enlace para ver el original.
    await page.getByRole("button", { name: "Traducción", exact: true }).click();
    await page.getByRole("radio", { name: "En lugar del original" }).click();
    await page.getByRole("button", { name: "Cerrar" }).click();
    await page.waitForFunction(() => document.querySelectorAll("[data-translated]").length === 0);
    assert.match(await page.locator("[data-message-id='f3']").innerText(), /\[es\] I miss you so much/);
    await page.locator("[data-message-id='f3']").getByRole("button", { name: "Ver original" }).click();
    assert.match(await page.locator("[data-message-id='f3']").innerText(), /^I miss you so much/m);
    assert.equal(await page.locator("[data-message-id='f3']").innerText().then((t) => t.includes("[es]")), false);

    // Compositor: traduce al idioma del fan (detectado: inglés) y lo deja en el cuadro, sin enviar.
    await page.getByRole("button", { name: "Translation", exact: true }).click();
    await page.getByRole("region", { name: "Panel Translation" }).waitFor();
    assert.equal(await page.getByRole("button", { name: /Traducir mi mensaje/ }).isDisabled(), true, "sin texto no traduce");
    await page.getByRole("textbox", { name: "Mensaje" }).fill("Hola guapo, ¿qué tal estás hoy?");
    await page.getByRole("combobox", { name: "Lengua del fan" }).selectOption("auto");
    await page.getByRole("button", { name: "Traducir mi mensaje a Inglés" }).click();
    await page.getByText(/Traducido de ES a EN/).waitFor();
    assert.equal(await page.getByRole("textbox", { name: "Mensaje" }).innerText(), "[en] Hola guapo, ¿qué tal estás hoy?");
    assert.equal(await page.locator("[data-message-id]").count(), 4, "no se ha enviado nada: los mensajes son los mismos");
    await page.getByRole("button", { name: "Volver al original" }).click();
    assert.equal(await page.getByRole("textbox", { name: "Mensaje" }).innerText(), "Hola guapo, ¿qué tal estás hoy?");
    await page.close();
  } finally {
    await browser.close().catch(() => undefined);
    server.kill("SIGTERM");
  }
});

test("traductor: sin la API del navegador el aviso es claro y no dice Sin datos", async () => {
  const dir = path.join(tmpdir(), `fanlink-translate-off-${Date.now()}`);
  await seed(dir);
  const server = startDev(dir);
  const browser = await chromium.launch();
  try {
    await waitForServer(`http://127.0.0.1:${port}/mensajes`);
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.addInitScript("delete window.Translator; delete window.LanguageDetector;");
    await page.goto(`http://127.0.0.1:${port}/mensajes`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: /Fan Uno/ }).click();
    const fanMessage = page.locator("[data-message-id='f1']");
    await fanMessage.waitFor({ timeout: 60_000 });
    await page.getByRole("button", { name: "Traducción", exact: true }).click();
    await page.getByRole("alert").getByText(/Chrome 138/).waitFor();
    await page.getByRole("button", { name: "Cerrar" }).click();
    await fanMessage.getByRole("button", { name: "Traducir mensaje" }).click();
    await fanMessage.getByText(/no tiene el traductor integrado/).waitFor();
    await page.getByRole("button", { name: "Translation", exact: true }).click();
    const panel = page.getByRole("region", { name: "Panel Translation" });
    await panel.getByText(/Chrome 138/).waitFor();
    assert.equal(await panel.getByText(/Sin datos/).count(), 0);
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
  const rows: Array<[string, boolean, string]> = [
    ["c0", false, "Hola guapo, ¿cómo estás?"],
    ["f1", true, "Hello, how are you today?\nI really missed you"],
    ["c2", false, "Te echaba de menos"],
    ["f3", true, "I miss you so much"],
  ];
  for (const [index, [key, fromFan, body]] of rows.entries()) {
    await pg.query(
      `insert into of_chat_message (
         creator_id, message_key, thread_key, fan_key, from_fan, body, sent_at, synced_at, origin, seen
       ) values ('cpreview', $1, '7', '7', $2, $3, $4, now(), 'onlyfans', $5)`,
      [key, fromFan, body, new Date(Date.UTC(2026, 10, 20, 10, index)).toISOString(), fromFan ? null : true],
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
