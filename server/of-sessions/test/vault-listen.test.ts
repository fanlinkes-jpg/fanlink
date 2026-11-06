import assert from "node:assert/strict";
import { test } from "node:test";
import { chromium } from "playwright";
import { parseVaultPayload, captureVaultList } from "../sync/vault-listen.ts";
import { startFixture } from "./fixture-site.ts";

test("el listado del vault sale del JSON que ya pidió la página", () => {
  assert.deepEqual(parseVaultPayload({ list: [{ id: 4, type: "video", name: "clip" }] }), [
    { id: "4", title: "clip", kind: "video" },
  ]);
  assert.deepEqual(parseVaultPayload({ html: "<div>" }), []);
});

test("el vault se lee de lo que pide la página al abrirlo", async () => {
  const fixture = await startFixture();
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    await context.addCookies([
      { name: "sess", value: "ok-1", url: fixture.origin },
      { name: "auth_id", value: "42", url: fixture.origin },
    ]);
    const page = await context.newPage();
    await page.goto(`${fixture.origin}/my/chats/chat/9`, { waitUntil: "domcontentloaded" });
    const items = await captureVaultList(page);
    assert.deepEqual(items, [{ id: "v1", title: "playa", kind: "foto" }]);
    await page.close();
  } finally {
    await browser.close();
    await fixture.close();
  }
});
