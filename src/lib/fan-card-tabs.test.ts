import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { chromium, type Page } from "playwright";
import { FAN_CARD_TABS } from "./fan-card-tabs.ts";
import { assertDevPortFree, forgetPgliteDir, privatePgliteDir, shotFile } from "./dev-test-server.ts";

const root = path.resolve(import.meta.dirname, "../..");

test("las pestañas de la ficha son Insights, Ventas y Notas", () => {
  assert.deepEqual([...FAN_CARD_TABS], ["Insights", "Ventas", "Notas"]);
});

test("la ficha del fan pinta las tres pestañas", async () => {
  const port = await freePort();
  const server = await startDev(port);
  const browser = await chromium.launch();
  try {
    await waitForServer(`http://127.0.0.1:${port}/mensajes`);
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.route("**/*", async (route) => {
      const request = route.request();
      if (request.headers()["x-tsr-serverfn"] === "true" && serverExport(request.url()).includes("listCreatorChats")) {
        await route.fulfill({
          status: 200,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ result: fanChat() }),
        });
        return;
      }
      await route.continue();
    });
    await page.goto(`http://127.0.0.1:${port}/mensajes`, { waitUntil: "domcontentloaded" });
    await page.getByText("Fan sin gasto").first().waitFor();
    await page.getByRole("button", { name: "Ficha del fan" }).click();
    const dialog = page.getByRole("dialog", { name: "Ficha del fan" });
    await dialog.waitFor();
    await dialog.getByText("Gasto total").waitFor();
    await dialog.getByText("$0.00").first().waitFor();
    await dialog.getByRole("button", { name: "Ventas", exact: true }).click();
    await dialog.getByText("Precio más alto").waitFor();
    await dialog.getByText("$0.00").first().waitFor();
    await dialog.getByRole("button", { name: "Notas", exact: true }).click();
    await dialog.getByRole("button", { name: "Insights", exact: true }).click();
    const shot = await saveShot(page);
    assert.ok(shot.endsWith("ficha-fan.png"));
  } finally {
    await browser.close().catch(() => undefined);
    server.kill("SIGTERM");
  }
});

function serverExport(url: string): string {
  const raw = decodeURIComponent(url.split("/_serverFn/")[1]?.split("?")[0] ?? "");
  if (!raw) return "";
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as { export?: string };
    return parsed.export ?? "";
  } catch {
    return "";
  }
}

function fanChat() {
  return {
    runningCreatorIds: [],
    threads: [{
      creatorId: "3zk7kbr",
      threadKey: "t1",
      fanKey: "fan",
      fanHandle: "@fan",
      fanName: "Fan sin gasto",
      lastMessageAt: "2026-01-02T00:00:00.000Z",
      excerpt: "hola",
      unread: 0,
      lastFromFan: true,
      spentCents: 0,
      subscribesCents: 0,
      tipsCents: 0,
      postsCents: 0,
      messagesCents: 0,
      avatarUrl: null,
      online: null,
      subPriceCents: 0,
      subExpiresAt: null,
      renewAuto: false,
      lists: [],
    }],
    messages: [],
    meta: [],
    pending: [],
    notes: [],
    profiles: [],
    accounts: [{
      creatorId: "3zk7kbr",
      sessionRejected: false,
      connection: "not_checked",
      hasStorageState: false,
      loginInProgress: false,
      status: "pending_login",
    }],
    sessionNotices: [],
  };
}

async function saveShot(page: Page): Promise<string> {
  const name = "ficha-fan.png";
  const shotPath = shotFile(name);
  try {
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

async function startDev(port: number): Promise<ChildProcess> {
  await assertDevPortFree();
  const dataDir = await privatePgliteDir();
  const env: NodeJS.ProcessEnv = { ...process.env, VITE_AUTH_ENABLED: "false", FANLINK_PGLITE_DIR: dataDir };
  delete env.DATABASE_URL;
  const child = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "dev", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
    cwd: root,
    env,
    stdio: "ignore",
  });
  forgetPgliteDir(child, dataDir);
  return child;
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
