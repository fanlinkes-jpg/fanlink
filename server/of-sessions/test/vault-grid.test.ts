import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { chromium, type Page } from "playwright";
import { VAULT_CARD_FRAME, VAULT_CARD_IMAGE } from "../../../src/lib/vault-card-frame.ts";

const root = path.resolve(import.meta.dirname, "../../..");

test("la cuadrícula de la bóveda no aplasta una tira a unos píxeles", async () => {
  const frame = Object.entries(VAULT_CARD_FRAME).map(([key, value]) => `${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}:${value}`).join(";");
  const image = Object.entries(VAULT_CARD_IMAGE).map(([key, value]) => `${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}:${value}`).join(";");
  const cards = Array.from({ length: 4 }, () => `
    <button data-vault-card style="padding:0;border:0;background:#f2f3f5;${frame}">
      <img alt="" width="400" height="8" style="${image}" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" />
      <span style="position:absolute;top:6px;right:6px">Posted</span>
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
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    let vaultReads = 0;
    let lastVaultBody = "";
    const seenExports: string[] = [];
    await page.route("**/*", async (route) => {
      const request = route.request();
      const url = request.url();
      if (url.includes("/api/vault-media")) {
        await route.fulfill({ status: 200, contentType: "image/png", body: png });
        return;
      }
      if (request.headers()["x-tsr-serverfn"] === "true") seenExports.push(serverExport(url));
      if (request.headers()["x-tsr-serverfn"] === "true" && serverExport(url).includes("listCreatorChats")) {
        await route.fulfill({
          status: 200,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ result: chatList() }),
        });
        return;
      }
      if (request.headers()["x-tsr-serverfn"] === "true" && serverExport(url).includes("readChatVault")) {
        vaultReads += 1;
        await route.fulfill({
          status: 200,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ result: { items: [], reason: null, hasMore: true, nextOffset: 24, cached: false } }),
        });
        return;
      }
      if (request.headers()["x-tsr-serverfn"] === "true" && isVaultQuery(url)) {
        await route.fulfill({
          status: 200,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ result: vaultView(folderOf(lastVaultBody = request.postData() ?? "")) }),
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
    await page.getByText("Fan de prueba").first().waitFor();
    await page.getByRole("button", { name: "Add from media vault", exact: true }).click();
    const panel = page.getByRole("region", { name: "Panel Add from media vault" });
    await panel.getByText("B/G LA DUCHA").waitFor();
    await panel.getByText("4 fotos · 2 vídeos").waitFor();
    await panel.getByText("22 fotos · 18 vídeos").waitFor();
    const box = await panel.locator("[data-vault-card]").first().boundingBox();
    assert.ok(box, "VaultBrowser no pintó tarjetas");
    assert.ok(box.height >= 80, `alto ${box.height}`);
    assert.ok(Math.abs(box.width - box.height) <= 8, `no es cuadrada ${box.width}x${box.height}`);
    const panelBox = await panel.boundingBox();
    assert.ok(panelBox, "el modal no tiene caja");
    assert.ok(panelBox.width >= 1440 * 0.9, `ancho modal ${panelBox.width}`);
    assert.ok(panelBox.height >= 900 * 0.9, `alto modal ${panelBox.height}`);
    await panel.getByText("Publicado").first().waitFor();
    await panel.getByText("Enviado 2").waitFor();
    assert.equal(await panel.getByText("Sin datos", { exact: true }).count(), 0);
    assert.equal(await panel.getByText("Sin miniatura").count(), 0);
    const until = Date.now() + 5_000;
    while (vaultReads < 1 && Date.now() < until) await new Promise((resolve) => setTimeout(resolve, 50));
    const cards = panel.locator("[data-vault-card]");
    assert.equal(await cards.count(), 40);
    const last = cards.last();
    await last.scrollIntoViewIfNeeded();
    const lastBox = await last.boundingBox();
    const gridBox = await panel.locator(".overflow-y-auto").last().boundingBox();
    assert.ok(lastBox && gridBox, "la última tarjeta no se pudo medir");
    assert.ok(lastBox.y >= gridBox.y - 4 && lastBox.y + lastBox.height <= gridBox.y + gridBox.height + 4, `la última tarjeta queda fuera ${lastBox.y}/${gridBox.y}`);
    const more = Date.now() + 5_000;
    while (vaultReads < 2 && Date.now() < more) await new Promise((resolve) => setTimeout(resolve, 50));
    assert.ok(vaultReads >= 2, `el scroll no pidió otra página (${vaultReads}) vistos ${seenExports.join(" | ")}`);
    const shotPath = await savePanelShot(page);
    assert.ok(shotPath.endsWith("boveda-panel-1440.png"));
    await panel.getByRole("button", { name: /LA DUCHA/ }).click();
    await page.waitForFunction(() => document.querySelectorAll("[data-vault-card]").length === 3);
    assert.equal(await panel.locator("[data-vault-card]").count(), 3);
  } finally {
    await browser.close().catch(() => undefined);
    server.kill("SIGTERM");
  }
});

function chatList() {
  const thread = {
    creatorId: "3zk7kbr",
    threadKey: "t1",
    fanKey: "fan",
    fanHandle: "@fan",
    fanName: "Fan de prueba",
    lastMessageAt: "2026-01-02T00:00:00.000Z",
    excerpt: "hola",
    unread: 0,
    lastFromFan: true,
    spentCents: null,
    subscribesCents: null,
    tipsCents: null,
    postsCents: null,
    messagesCents: null,
    avatarUrl: null,
    online: null,
    subPriceCents: null,
    subExpiresAt: null,
    renewAuto: null,
    lists: null,
  };
  return {
    runningCreatorIds: [],
    threads: [thread],
    messages: [],
    meta: [],
    pending: [],
    notes: [],
    profiles: [],
    accounts: [],
    sessionNotices: [],
  };
}

function folderOf(raw: string | null): string | null {
  if (!raw) return null;
  if (raw.includes('"s":"ducha"') || raw.includes('"folderId":"ducha"')) return "ducha";
  try {
    const body = JSON.parse(raw) as { query?: { folderId?: string | null }; data?: { query?: { folderId?: string | null } } };
    const id = body.data?.query?.folderId ?? body.query?.folderId ?? null;
    return typeof id === "string" && id ? id : null;
  } catch {
    return null;
  }
}

function isVaultQuery(url: string): boolean {
  return url.includes("cXVlcnlWYXVsdE1pcnJvc") || serverExport(url).includes("queryVaultMirror");
}

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

async function savePanelShot(page: Page): Promise<string> {
  const name = "boveda-panel-1440.png";
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

function vaultView(folderId: string | null = null) {
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
  const view = {
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
      ...Array.from({ length: 36 }, (_, index) => ({
        ...card,
        id: `m${index + 5}`,
        title: index === 35 ? "ultimo" : `medio ${index + 5}`,
        kind: "foto",
        seconds: null,
        folder: null,
        listId: null,
        listIds: [] as string[],
        sentCount: null,
        sent: null,
        priceLabel: null,
        posted: null,
        offerLabel: null,
        dateLabel: null,
      })),
    ],
    query: {
      text: "", kinds: [], minSeconds: null, maxSeconds: null, uploadedFrom: null, uploadedTo: null, list: null, folderId,
      scope: folderId ? "carpeta" : "todas", couples: [], offer: "todas", minPriceCents: null, maxPriceCents: null, sent: "cualquiera", bought: "cualquiera",
      bestSeller: false, minBuyRate: null, sort: "fecha", themes: [],
    },
  };
  if (!folderId) return view;
  return {
    ...view,
    items: view.items.filter((item) => item.listId === folderId || item.listIds.some((id: string) => id === folderId)),
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
