import assert from "node:assert/strict";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { test } from "node:test";
import { chromium, type Page } from "playwright";

const root = path.resolve(import.meta.dirname, "../../..");
const port = 18751;

type Api = { open: (thread: string, count: number) => void; prepend: (count: number) => void; append: (count: number) => void; bar: (px: number) => void; growLast: (px: number) => void };
declare global { interface Window { api: Api } }

const gap = (page: Page) => page.locator("ol").evaluate((list) => Math.round(list.scrollHeight - list.scrollTop - list.clientHeight));
const top = (page: Page) => page.locator("ol").evaluate((list) => Math.round(list.scrollTop));
/** Primer mensaje que se ve y a qué altura de la pantalla está. */
const firstVisible = (page: Page) => page.locator("ol").evaluate((list) => {
  const box = list.getBoundingClientRect();
  for (const item of Array.from(list.querySelectorAll<HTMLElement>("[data-message-id]"))) {
    const rect = item.getBoundingClientRect();
    if (rect.bottom > box.top + 1) return { key: item.dataset.messageId ?? "", y: rect.top - box.top };
  }
  return { key: "", y: 0 };
});
const keyY = (page: Page, key: string) => page.locator("ol").evaluate((list, wanted) => {
  const item = list.querySelector<HTMLElement>(`[data-message-id="${wanted}"]`);
  return item ? item.getBoundingClientRect().top - list.getBoundingClientRect().top : null;
}, key);

async function wheelOverList(page: Page, delta: number): Promise<void> {
  const box = await page.locator("ol").boundingBox();
  await page.mouse.move((box?.x ?? 0) + (box?.width ?? 0) / 2, (box?.y ?? 0) + (box?.height ?? 0) / 2);
  await page.mouse.wheel(0, delta);
}

test("el hook del chat: un gesto hacia arriba cancela los reintentos, el historial no mueve la lectura y solo se vuelve a pegar al bajar", async () => {
  const server = startVite();
  const browser = await chromium.launch();
  try {
    await waitForServer(`http://127.0.0.1:${port}/server/of-sessions/test/fixtures/stick-harness.html`);
    const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    await page.goto(`http://127.0.0.1:${port}/server/of-sessions/test/fixtures/stick-harness.html`);
    await page.waitForFunction(() => typeof window.api?.open === "function", null, { timeout: 60_000 });

    // 1. Abrir baja al final, también con scroll suave global y con crecimiento después.
    await page.evaluate(() => window.api.open("a", 200));
    await page.waitForTimeout(80);
    assert.ok((await gap(page)) <= 1, "abrir no baja al final");
    await page.evaluate(() => window.api.bar(140));
    await page.waitForTimeout(100);
    assert.ok((await gap(page)) <= 1, "con la lista encogida no sigue abajo");
    await page.evaluate(() => window.api.growLast(300));
    await page.waitForTimeout(100);
    assert.ok((await gap(page)) <= 1, "si crece el último mensaje no sigue abajo");
    await page.evaluate(() => window.api.bar(0));

    // 2. Subir durante la apertura, incluido el primer píxel: ningún reintento (120/400/1000/2500 ms) tira hacia abajo.
    for (const delta of [-3, -120]) {
      await page.evaluate(() => window.api.open("b", 200));
      await wheelOverList(page, delta);
      const samples: number[] = [];
      for (let index = 0; index < 14; index += 1) {
        await page.waitForTimeout(250);
        samples.push(await gap(page));
      }
      const label = `rueda ${delta}: ${JSON.stringify(samples)}`;
      assert.ok(samples[0] >= Math.abs(delta) - 1, `no subió: ${label}`);
      for (let index = 1; index < samples.length; index += 1) assert.ok(samples[index] >= samples[0] - 1, `volvió a bajar solo: ${label}`);
      await page.evaluate(() => window.api.append(1));
      await page.waitForTimeout(150);
      assert.ok((await gap(page)) >= samples[0] - 1 + 0, "un mensaje nuevo arrastra a quien está leyendo");
    }

    // 3. Historial antiguo al llegar arriba: lo que se lee no se mueve ni un píxel.
    await page.evaluate(() => window.api.open("c", 200));
    await page.waitForTimeout(80);
    await wheelOverList(page, -100000);
    await page.waitForTimeout(150);
    assert.ok((await top(page)) <= 2, "no llegó arriba");
    const before = await firstVisible(page);
    await page.evaluate(() => window.api.prepend(60));
    await page.waitForTimeout(150);
    const after = await keyY(page, before.key);
    assert.notEqual(after, null, "el mensaje que se leía desapareció");
    assert.ok(Math.abs((after ?? 0) - before.y) < 1, `el historial movió la lectura: ${before.y} -> ${after}`);
    assert.ok((await top(page)) > 100, "el scroll no se corrigió");
    // Y sigue sin tirar hacia abajo después.
    const held = await top(page);
    await page.waitForTimeout(1800);
    assert.ok(Math.abs((await top(page)) - held) <= 1, "se movió sola después del historial");
    // Varias tandas seguidas con la rueda por medio.
    for (let round = 0; round < 3; round += 1) {
      await wheelOverList(page, -100000);
      await page.waitForTimeout(80);
      const mark = await firstVisible(page);
      await page.evaluate(() => window.api.prepend(30));
      await page.waitForTimeout(120);
      assert.ok(Math.abs(((await keyY(page, mark.key)) ?? 9999) - mark.y) < 1, `la tanda ${round} movió la lectura`);
    }

    // 4. Solo se vuelve a pegar si baja por sí misma hasta menos de 30 px del final.
    await page.evaluate(() => window.api.open("d", 200));
    await page.waitForTimeout(80);
    await wheelOverList(page, -600);
    await page.waitForTimeout(100);
    const leaving = await gap(page);
    assert.ok(leaving >= 500, "no subió");
    await page.evaluate(() => window.api.append(2));
    await page.waitForTimeout(150);
    assert.ok((await gap(page)) >= leaving, "un mensaje nuevo bajó a quien está arriba");
    await wheelOverList(page, leaving - 200);
    await page.waitForTimeout(100);
    const near = await gap(page);
    assert.ok(near > 30, `debería quedar lejos del final: ${near}`);
    await page.evaluate(() => window.api.append(1));
    await page.waitForTimeout(150);
    assert.ok((await gap(page)) >= near - 1, "a más de 30 px del final se volvió a pegar");
    await wheelOverList(page, near + 100);
    await page.waitForTimeout(100);
    assert.ok((await gap(page)) <= 30);
    await page.evaluate(() => window.api.append(1));
    await page.waitForTimeout(150);
    assert.ok((await gap(page)) <= 1, "al bajar por sí misma no volvió a seguir el final");
    assert.deepEqual(errors, []);
    await page.close();
  } finally {
    await browser.close().catch(() => undefined);
    server.kill("SIGTERM");
  }
});

function startVite(): ChildProcess {
  return spawn(process.execPath, ["node_modules/vite/bin/vite.js", "dev", "--config", "server/of-sessions/test/fixtures/stick-harness.vite.config.ts", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
    cwd: root,
    env: { ...process.env },
    stdio: "ignore",
  });
}

async function waitForServer(url: string): Promise<void> {
  const deadline = Date.now() + 60_000;
  let last = "sin respuesta";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
      last = String(response.status);
    } catch (err) {
      last = err instanceof Error ? err.message : "error";
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`el servidor no arrancó: ${last}`);
}
