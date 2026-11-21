import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import test from "node:test";
import { chromium } from "playwright";
import { VAULT_CARD_FRAME, VAULT_CARD_IMAGE } from "../../../src/lib/vault-card-frame.ts";

const root = path.resolve(import.meta.dirname, "../../..");

test("la cuadrícula de la bóveda no aplasta una tira a unos píxeles", async () => {
  const frame = Object.entries(VAULT_CARD_FRAME).map(([key, value]) => `${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}:${value}`).join(";");
  const image = Object.entries(VAULT_CARD_IMAGE).map(([key, value]) => `${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}:${value}`).join(";");
  const cards = Array.from({ length: 4 }, () => `
    <button style="display:block;width:100%;padding:0;border:0;background:#fff">
      <span data-vault-card style="position:relative;display:block;overflow:hidden;background:#f2f3f5;${frame}">
        <img alt="" width="400" height="8" style="position:absolute;inset:0;${image}" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" />
        <span style="position:absolute;top:6px;right:6px">Publicado</span>
      </span>
    </button>`).join("");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
    await page.setContent(`<div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));width:640px;gap:12px">${cards}</div>`);
    const box = await page.locator("[data-vault-card]").first().boundingBox();
    assert.ok(box, "no hay tarjeta");
    assert.ok(box.height >= 80, `alto ${box.height}`);
    assert.ok(Math.abs(box.width - box.height) <= 4, `no es cuadrada ${box.width}x${box.height}`);
    const boxes = await page.locator("[data-vault-card]").evaluateAll((nodes) => nodes.map((node) => {
      const rect = node.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    }));
    assert.equal(boxes.length, 4);
    assert.ok(boxes.every((item) => item.height >= 80 && Math.abs(item.width - item.height) <= 8));
  } finally {
    await browser.close();
  }
});

test("el panel real del chat monta VaultBrowser con tarjetas cuadradas", async () => {
  const port = await freePort();
  const server = startDev(port);
  const browser = await chromium.launch();
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.route("**/*", async (route) => {
      const request = route.request();
      const url = request.url();
      if (url.includes("/api/vault-media")) {
        await route.fulfill({ status: 200, contentType: "image/png", body: png });
        return;
      }
      if (request.headers()["x-tsr-serverfn"] === "true" && isVaultQuery(url)) {
        await route.fulfill({
          status: 200,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ result: vaultView() }),
        });
        return;
      }
      await route.continue();
    });
    await waitForServer(`http://127.0.0.1:${port}/mensajes`);
    await page.goto(`http://127.0.0.1:${port}/mensajes`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Enviar" }).waitFor();
    await page.evaluate(async () => {
      const load = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<{
        useCrm: { setState: (patch: Record<string, unknown>) => void };
      }>;
      const mod = await load("/src/lib/crm.ts");
      mod.useCrm.setState({
        creators: [{
          id: "3zk7kbr",
          name: "Jose",
          handle: "@jose",
          platform: "onlyfans",
          city: "Madrid",
          subscribers: 10,
          revenue30: null,
          growth: 0,
          split: 20,
          status: "activa",
          hue: 200,
          proxy: "",
        }],
        creatorId: "3zk7kbr",
      });
    });
    await page.getByRole("button", { name: "Add from media vault", exact: true }).click();
    const panel = page.getByRole("region", { name: "Panel Add from media vault" });
    await panel.getByText("B/G LA DUCHA").waitFor();
    await panel.getByText("4 fotos · 2 vídeos").waitFor();
    await panel.getByText("22 fotos · 18 vídeos").waitFor();
    const box = await panel.locator("[data-vault-card]").first().boundingBox();
    assert.ok(box, "VaultBrowser no pintó tarjetas");
    assert.ok(box.height >= 80, `alto ${box.height}`);
    assert.ok(Math.abs(box.width - box.height) <= 8, `no es cuadrada ${box.width}x${box.height}`);
    const heights = await panel.locator("[data-vault-card]").evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().height));
    assert.ok(heights.every((height) => height >= 80), `altos ${heights.join(",")}`);
    assert.equal(await panel.getByText("Sin miniatura").count(), 0);
    await mkdir("/opt/cursor/artifacts", { recursive: true });
    await panel.screenshot({ path: "/opt/cursor/artifacts/boveda-panel.png" });
  } finally {
    await browser.close().catch(() => undefined);
    server.kill("SIGTERM");
  }
});

function isVaultQuery(url: string): boolean {
  return url.includes("cXVlcnlWYXVsdE1pcnJvc");
}

function vaultView() {
  const card = {
    tags: [] as string[],
    salesCount: null,
    ventasLabel: "Sin datos",
    bestSellerLabel: null,
    suggestedLabel: "Sin datos",
    buyLabel: null,
    packageLabel: "Sin datos",
    packageWithId: null,
    sentToFan: null,
    boughtByFan: null,
    blocked: false,
    history: [],
  };
  return {
    notice: null,
    lists: [
      { id: "all", name: "Todos", parentId: null, photos: 22, videos: 18, gifs: 0, audios: 0, hasMedia: true },
      { id: "ducha", name: "B/G LA DUCHA", parentId: null, photos: 4, videos: 2, gifs: 0, audios: 0, hasMedia: true },
    ],
    items: [
      { ...card, id: "m1", title: "foto", kind: "foto", seconds: null, folder: "B/G LA DUCHA", listId: "ducha", listIds: ["ducha"], sentCount: 2, sent: true, priceLabel: "Free", posted: true, offerLabel: null, dateLabel: "2 ene 26" },
      { ...card, id: "m2", title: "clip", kind: "video", seconds: 12, folder: "B/G LA DUCHA", listId: "ducha", listIds: ["ducha"], sentCount: null, sent: null, priceLabel: "$5.00", posted: null, offerLabel: "$5.00", dateLabel: "3 ene 26" },
      { ...card, id: "m3", title: "otra", kind: "foto", seconds: null, folder: "B/G LA DUCHA", listId: "ducha", listIds: ["ducha"], sentCount: null, sent: false, priceLabel: "Sin datos", posted: false, offerLabel: null, dateLabel: null },
      { ...card, id: "m4", title: "mas", kind: "foto", seconds: null, folder: null, listId: null, listIds: [], sentCount: null, sent: null, priceLabel: "Sin datos", posted: null, offerLabel: null, dateLabel: null },
    ],
    query: {
      text: "", kinds: [], minSeconds: null, maxSeconds: null, uploadedFrom: null, uploadedTo: null, list: null, folderId: null,
      scope: "todas", couples: [], offer: "todas", minPriceCents: null, maxPriceCents: null, sent: "cualquiera", bought: "cualquiera",
      bestSeller: false, minBuyRate: null, sort: "fecha", themes: [],
    },
  };
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
