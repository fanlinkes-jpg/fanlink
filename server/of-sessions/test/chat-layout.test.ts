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
  { width: 1024, height: 630, capture: false },
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
      if (viewport.capture) {
        await page.screenshot({ path: path.join(shots, `mensajes-${viewport.width}x${viewport.height}.png`) });
      }
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
    const parts = ["Traducción", "Guiones", "Galería", "Dejar pendiente"].map((label) => {
      const node = [...document.querySelectorAll("button")].find((item) => item.textContent?.includes(label));
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
