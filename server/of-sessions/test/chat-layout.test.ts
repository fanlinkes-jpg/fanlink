import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { chromium, type Page } from "playwright";

const root = path.resolve(import.meta.dirname, "../../..");
const port = 18731;
const shots = path.join(root, "tmp/chat-layout");

const viewports = [
  { width: 1024, height: 630, capture: true },
  { width: 1280, height: 720, capture: false },
  { width: 1440, height: 900, capture: true },
] as const;

test("el botón Enviar se ve entero sin scroll de página", async () => {
  const server = startDev();
  const browser = await chromium.launch();
  try {
    await waitForServer(`http://127.0.0.1:${port}/mensajes`);
    await mkdir(shots, { recursive: true });
    for (const viewport of viewports) {
      const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height } });
      await page.goto(`http://127.0.0.1:${port}/mensajes`, { waitUntil: "domcontentloaded" });
      await page.getByRole("button", { name: "Enviar" }).waitFor();
      await page.locator("ol").evaluate((list) => {
        for (let index = 0; index < 40; index += 1) {
          const item = document.createElement("li");
          item.textContent = `Mensaje de prueba ${index} `.repeat(6);
          item.style.minHeight = "48px";
          list.appendChild(item);
        }
      });
      const seen = await sendButtonBox(page);
      const label = `${viewport.width}x${viewport.height}`;
      assert.equal(seen.found, true, `${label}: no está el botón`);
      assert.ok(seen.top >= 0, `${label}: el botón sale por arriba`);
      assert.ok(seen.bottom <= viewport.height + 1, `${label}: el botón sale por abajo`);
      assert.ok(seen.left >= 0 && seen.right <= viewport.width + 1, `${label}: el botón sale por un lado`);
      assert.equal(seen.hit, true, `${label}: el botón está tapado`);
      assert.equal(seen.scrollY, 0);
      assert.ok(seen.scrollHeight <= seen.innerHeight + 1, `${label}: la página hace scroll`);
      assert.ok(seen.formTop >= 0 && seen.formBottom <= viewport.height + 1, `${label}: el compositor no cabe`);
      for (const part of seen.parts) {
        assert.ok(part.top >= 0 && part.bottom <= viewport.height + 1, `${label}: ${part.label} queda fuera`);
      }
      const composer = page.locator("form");
      const toolLabels = await page.getByRole("toolbar", { name: "Herramientas del mensaje" }).getByRole("button").evaluateAll((nodes) => (
        nodes.map((node) => node.getAttribute("aria-label"))
      ));
      assert.deepEqual(toolLabels, [
        "Add media",
        "GIF",
        "Add from media vault",
        "Schedule your message",
        "Price",
        "Tag other creator",
        "Format text",
        "Translation",
        "Enviar",
      ]);
      const send = composer.getByRole("button", { name: "Enviar", exact: true });
      assert.equal(await send.isDisabled(), true);
      assert.equal(await send.getAttribute("title"), "Envío real desactivado en esta cuenta");
      assert.equal(await composer.getByRole("button", { name: "Dejar pendiente" }).count(), 0);
      await composer.getByText("Pulsa / + palabra para buscar guiones").waitFor();
      const box = composer.getByRole("textbox", { name: "Mensaje" });
      await box.click();
      await page.keyboard.type("hola");
      await page.keyboard.press("Enter");
      assert.equal((await box.innerText()).includes("\n"), false);
      await page.keyboard.down("Shift");
      await page.keyboard.press("Enter");
      await page.keyboard.up("Shift");
      assert.equal((await box.innerText()).includes("\n"), true);
      await box.evaluate((node) => {
        node.textContent = "";
      });
      if (viewport.capture) {
        await page.screenshot({ path: path.join(shots, `mensajes-${viewport.width}x${viewport.height}.png`) });
      }
      const file = composer.locator("input[type=file]");
      assert.equal(await file.getAttribute("accept"), "image/*,video/*");
      assert.notEqual(await file.getAttribute("multiple"), null);
      const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
      const [chooser] = await Promise.all([
        page.waitForEvent("filechooser"),
        composer.getByRole("button", { name: "Add media", exact: true }).click(),
      ]);
      await chooser.setFiles({ name: "foto.png", mimeType: "image/png", buffer: png });
      await composer.getByRole("img", { name: "foto.png" }).waitFor();
      await composer.getByRole("button", { name: "Quitar foto.png" }).click();
      await composer.getByRole("img", { name: "foto.png" }).waitFor({ state: "hidden" });
      for (const name of ["GIF", "Add from media vault", "Tag other creator", "Format text", "Translation", "Guiones"]) {
        const region = page.getByRole("region", { name: `Panel ${name}` });
        await composer.getByRole("button", { name, exact: true }).click();
        await region.waitFor();
        if (name === "Add from media vault" || name === "Tag other creator") await region.getByText("Sin datos").waitFor();
        if (name === "GIF") await region.getByText("Sin datos. Hace falta una clave de API para buscar GIF.").waitFor();
        if (name === "Format text") await region.getByRole("button", { name: "Color Rojo" }).waitFor();
        if (name === "Translation") await region.getByText("Sin datos: no hay servicio de traducción.").waitFor();
        await composer.getByRole("button", { name, exact: true }).click();
        await region.waitFor({ state: "hidden" });
      }
      await composer.getByRole("button", { name: "Schedule your message", exact: true }).click();
      const schedule = page.getByRole("dialog", { name: "Programar tu mensaje" });
      await schedule.getByLabel("Fecha programada").waitFor();
      await schedule.getByRole("button", { name: "Cancelar" }).click();
      await schedule.waitFor({ state: "hidden" });
      await composer.getByRole("button", { name: "Price", exact: true }).click();
      const price = page.getByRole("dialog", { name: "Precio del mensaje" });
      await price.getByText("Mínimo $3 USD o gratis").waitFor();
      await price.getByText("Últimos PPV comprados por el fan").waitFor();
      await price.getByText("Sin datos").first().waitFor();
      const amount = price.getByRole("textbox", { name: "Precio" });
      await amount.fill("1");
      assert.equal(await price.getByRole("button", { name: "Guardar" }).isDisabled(), true);
      await amount.fill("5");
      assert.equal(await price.getByRole("button", { name: "Guardar" }).isDisabled(), false);
      await amount.fill("");
      if (viewport.capture) {
        await page.screenshot({ path: path.join(shots, `precio-${viewport.width}x${viewport.height}.png`) });
      }
      await price.getByRole("button", { name: "Cancelar" }).click();
      await price.waitFor({ state: "hidden" });
      const dialog = page.getByRole("dialog", { name: "Ficha del fan" });
      await page.getByRole("button", { name: "Ficha del fan" }).click();
      await dialog.waitFor();
      await dialog.getByText("Comportamiento de gasto").waitFor();
      await dialog.getByText("Métricas").waitFor();
      await dialog.getByText("Suscripción").waitFor();
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "hidden" });
      await page.getByRole("button", { name: "Ficha del fan" }).click();
      await dialog.waitFor();
      await page.getByRole("button", { name: "Cerrar", exact: true }).click();
      await dialog.waitFor({ state: "hidden" });
      const after = await sendButtonBox(page);
      assert.equal(after.found, true, `${label}: el botón desaparece al cerrar la ficha`);
      assert.ok(after.bottom <= viewport.height + 1, `${label}: el botón sale por abajo al cerrar la ficha`);
      await page.close();
    }
  } finally {
    await browser.close().catch(() => undefined);
    server.kill("SIGTERM");
  }
});

function startDev(): ChildProcess {
  const env: NodeJS.ProcessEnv = { ...process.env, VITE_AUTH_ENABLED: "false" };
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

async function sendButtonBox(page: Page): Promise<{
  found: boolean;
  top: number;
  bottom: number;
  left: number;
  right: number;
  hit: boolean;
  scrollY: number;
  scrollHeight: number;
  innerHeight: number;
  formTop: number;
  formBottom: number;
  parts: Array<{ label: string; top: number; bottom: number }>;
}> {
  return page.evaluate(() => {
    const button = [...document.querySelectorAll("button")].find((node) => node.getAttribute("aria-label") === "Enviar");
    const form = document.querySelector("form");
    const formRect = form?.getBoundingClientRect();
    const parts = ["Add media", "GIF", "Add from media vault", "Schedule your message", "Price", "Tag other creator", "Format text", "Translation", "Guiones", "Enviar"].map((label) => {
      const node = [...document.querySelectorAll("button")].find((item) => item.getAttribute("aria-label") === label || item.textContent?.includes(label));
      const box = node?.getBoundingClientRect();
      return { label, top: box?.top ?? -1, bottom: box?.bottom ?? -1 };
    });
    if (!button) {
      return {
        found: false, top: 0, bottom: 0, left: 0, right: 0, hit: false, scrollY: 0, scrollHeight: 0, innerHeight: 0,
        formTop: formRect?.top ?? -1, formBottom: formRect?.bottom ?? -1, parts,
      };
    }
    const rect = button.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return {
      found: true,
      top: rect.top,
      bottom: rect.bottom,
      left: rect.left,
      right: rect.right,
      hit: hit === button || button.contains(hit),
      scrollY: window.scrollY,
      scrollHeight: document.documentElement.scrollHeight,
      innerHeight: window.innerHeight,
      formTop: formRect?.top ?? -1,
      formBottom: formRect?.bottom ?? -1,
      parts,
    };
  });
}
