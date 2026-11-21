import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright";
import { VAULT_CARD_FRAME, VAULT_CARD_IMAGE } from "../../../src/lib/vault-card-frame.ts";

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
    assert.ok(box.height >= 96, `alto ${box.height}`);
    assert.ok(Math.abs(box.width - box.height) <= 4, `no es cuadrada ${box.width}x${box.height}`);
    const boxes = await page.locator("[data-vault-card]").evaluateAll((nodes) => nodes.map((node) => {
      const rect = node.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    }));
    assert.equal(boxes.length, 4);
    assert.ok(boxes.every((item) => item.height >= 96 && Math.abs(item.width - item.height) <= 4));
  } finally {
    await browser.close();
  }
});
