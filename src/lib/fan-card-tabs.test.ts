import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { chromium, type Page } from "playwright";
import { FAN_CARD_TABS } from "./fan-card-tabs.ts";

const root = path.resolve(import.meta.dirname, "../..");

test("las pestañas de la ficha son Insights, Ventas y Notas", () => {
  assert.deepEqual([...FAN_CARD_TABS], ["Insights", "Ventas", "Notas"]);
});

test("la ficha del fan pinta las tres pestañas", async () => {
  const port = await freePort();
  const server = startDev(port);
  const browser = await chromium.launch();
  try {
    await waitForServer(`http://127.0.0.1:${port}/mensajes`);
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(`http://127.0.0.1:${port}/mensajes`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Ficha del fan" }).click();
    const dialog = page.getByRole("dialog", { name: "Ficha del fan" });
    await dialog.waitFor();
    for (const tab of FAN_CARD_TABS) await dialog.getByRole("button", { name: tab, exact: true }).click();
    const shot = await saveShot(page);
    assert.ok(shot.endsWith("ficha-fan.png"));
  } finally {
    await browser.close().catch(() => undefined);
    server.kill("SIGTERM");
  }
});

async function saveShot(page: Page): Promise<string> {
  const name = "ficha-fan.png";
  const artifacts = "/opt/cursor/artifacts";
  try {
    await mkdir(artifacts, { recursive: true });
    const shotPath = path.join(artifacts, name);
    await page.screenshot({ path: shotPath });
    return shotPath;
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    if (code !== "EACCES" && code !== "ENOENT") throw error;
    const shotPath = path.join(tmpdir(), name);
    await page.screenshot({ path: shotPath });
    return shotPath;
  }
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

function startDev(port: number): ChildProcess {
  const env: NodeJS.ProcessEnv = { ...process.env, VITE_AUTH_ENABLED: "false" };
  delete env.DATABASE_URL;
  return spawn(process.execPath, ["node_modules/vite/bin/vite.js", "dev", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
    cwd: root,
    env,
    stdio: "ignore",
  });
}

async function waitForServer(url: string): Promise<void> {
  const deadline = Date.now() + 40_000;
  let last = "sin respuesta";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok || response.status < 500) return;
      last = String(response.status);
    } catch (error) {
      last = error instanceof Error ? error.message : "error";
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`el servidor no arrancó: ${last}`);
}
