import assert from "node:assert/strict";
import { test } from "node:test";
import { chromium } from "playwright";
import { liveDeskPresentationSource, LIVE_DESK_PRESENTATION_CSS } from "../live/desk.ts";

/** Maqueta con las reglas públicas de OnlyFans que reservan sitio a la barra lateral. */
const FIXTURE = `<!doctype html><html><head><style>
  body { margin: 0; }
  .container { margin: 0 auto; padding: 0 16px; width: 100%; max-width: 1312px; box-sizing: border-box; }
  .container.m-main-container { display: flex; flex-direction: row; align-items: flex-start; padding-right: 16px; }
  .l-header { position: sticky; top: 0; width: 264px; flex: 0 0 264px; height: 100vh; background: #ddd; }
  .m-main-container #content { margin-left: auto; max-width: calc(100% - 264px); flex: 1; min-width: 0; width: 100%; }
  .container.m-main-container:not(.m-right-sidebar) #content > .b-chats > .b-chats__conversations { width: 100%; max-width: 999px; margin-left: auto; margin-right: 0; }
  .b-chats { display: flex; flex-direction: column; flex: 1; width: 100%; }
  .b-chats__conversations { display: flex; flex-grow: 1; }
  .b-chats__conversations-list { display: flex; flex-direction: column; max-width: 395px; flex: 0 0 395px; }
  .b-chats__conversations-content { flex-grow: 1; width: 100%; }
  .l-footer { height: 40px; }
</style></head><body>
<div class="container m-main-container">
  <header class="l-header"><nav class="l-header__menu"><a>Inicio</a></nav></header>
  <div id="content">
    <div class="g-page__header">Mensajes</div>
    <div class="b-chats"><div class="b-chats__conversations">
      <div class="b-chats__conversations-list">lista</div>
      <div class="b-chats__conversations-content">conversación</div>
    </div></div>
  </div>
</div>
<footer class="l-footer">pie</footer>
</body></html>`;

test("Operativa oculta la barra lateral y el pie de OnlyFans y el contenido ocupa todo el ancho", async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });
  const requests: string[] = [];
  try {
    await page.route("**/*", (route) => {
      requests.push(route.request().url());
      return route.fulfill({ status: 200, contentType: "text/html", body: FIXTURE });
    });
    await page.addInitScript({ content: liveDeskPresentationSource(true) });
    await page.goto("https://onlyfans.com/my/chats", { waitUntil: "domcontentloaded" });
    const look = await page.evaluate(() => {
      const box = (selector: string) => document.querySelector(selector)?.getBoundingClientRect();
      const shown = (selector: string) => {
        const node = document.querySelector(selector);
        return node != null && getComputedStyle(node).display !== "none";
      };
      return {
        header: shown("header.l-header"),
        footer: shown(".l-footer"),
        styles: document.querySelectorAll("#fanlink-desk-presentation").length,
        content: box("#content"),
        conversations: box(".b-chats__conversations"),
        list: box(".b-chats__conversations-list"),
        conversation: box(".b-chats__conversations-content"),
        title: shown(".g-page__header"),
        width: window.innerWidth,
      };
    });
    assert.equal(look.header, false);
    assert.equal(look.footer, false);
    assert.equal(look.styles, 1);
    assert.equal(look.title, true);
    assert.equal(Math.round(look.content!.left), 0);
    assert.equal(Math.round(look.content!.width), look.width);
    assert.equal(Math.round(look.conversations!.width), look.width);
    assert.equal(Math.round(look.list!.width), 395);
    assert.ok(look.conversation!.width > 400);
    assert.ok(look.conversation!.left >= look.list!.right - 1);
    // Solo presentación: ninguna petición más que la propia página.
    assert.deepEqual(requests, ["https://onlyfans.com/my/chats"]);
  } finally {
    await browser.close();
  }
});

test("sin Operativa la hoja no se aplica y una sala siguiente la apaga", async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });
  try {
    await page.route("**/*", (route) => route.fulfill({ status: 200, contentType: "text/html", body: FIXTURE }));
    await page.addInitScript({ content: liveDeskPresentationSource(true) });
    await page.addInitScript({ content: liveDeskPresentationSource(false) });
    await page.goto("https://onlyfans.com/my/chats/chat/7", { waitUntil: "domcontentloaded" });
    const state = await page.evaluate(() => ({
      styles: document.querySelectorAll("#fanlink-desk-presentation").length,
      header: getComputedStyle(document.querySelector("header.l-header")!).display,
    }));
    assert.equal(state.styles, 0);
    assert.notEqual(state.header, "none");
  } finally {
    await browser.close();
  }
});

test("la hoja solo toca la presentación: nada de la huella, el UA ni la red", () => {
  assert.doesNotMatch(liveDeskPresentationSource(true), /userAgent|fetch\(|XMLHttpRequest|navigator\./);
  assert.doesNotMatch(LIVE_DESK_PRESENTATION_CSS, /url\(|@import/);
});
