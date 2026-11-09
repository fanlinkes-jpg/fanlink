import assert from "node:assert/strict";
import { test } from "node:test";
import { chromium } from "playwright";
import { normalizeFanMenuRequest, runFanMenuOnPage } from "../sync/fan-menu.ts";

const html = `<!doctype html>
<button aria-label="Más">Más</button>
<div id="menu" hidden>
  <button type="button" id="lists">Añadir o quitar de listas</button>
  <button type="button" id="discount">Dar un descuento</button>
  <button type="button" id="block">Bloquear</button>
</div>
<div id="listbox" hidden role="menu">
  <button type="button" role="menuitemcheckbox" aria-checked="false">VIP</button>
  <button type="button" role="menuitemcheckbox" aria-checked="true">Novios</button>
</div>
<div id="discount-box" hidden>
  <input type="number" aria-label="Porcentaje" />
  <button type="button" id="save">Guardar</button>
</div>
<div id="ask" hidden role="dialog" aria-label="Confirmar">
  <button type="button" id="confirm">Bloquear</button>
</div>
<p id="state"></p>
<script>
  const menu = document.getElementById("menu");
  document.querySelector("[aria-label=Más]").onclick = () => { menu.hidden = false; };
  document.getElementById("lists").onclick = () => { document.getElementById("listbox").hidden = false; };
  document.getElementById("discount").onclick = () => { document.getElementById("discount-box").hidden = false; };
  document.getElementById("save").onclick = () => { document.getElementById("state").textContent = "descuento " + document.querySelector("input").value; };
  document.getElementById("block").onclick = () => { document.getElementById("ask").hidden = false; };
  document.getElementById("confirm").onclick = () => { document.getElementById("state").textContent = "bloqueado"; };
  document.querySelector("[role=menuitemcheckbox]").onclick = () => { document.getElementById("state").textContent = "lista VIP"; };
</script>`;

test("el menú del chat no acepta un descuento imposible", () => {
  assert.equal(normalizeFanMenuRequest({ action: "discount", percent: 0 }), null);
  assert.equal(normalizeFanMenuRequest({ action: "discount", percent: 10 })?.action, "discount");
  assert.equal(normalizeFanMenuRequest({ action: "report", reason: "   " }), null);
});

test("el menú pulsa listas, descuento y bloquear en la página del chat", async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.route("https://onlyfans.com/**", (route) => route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: html }));
    const lists = await runFanMenuOnPage(page, "https://onlyfans.com/my/chats/chat/7", { action: "lists" });
    assert.equal(lists.ok, true);
    assert.deepEqual(lists.lists.map((item) => item.name), ["VIP", "Novios"]);
    assert.equal(lists.lists[1]?.on, true);
    const picked = await runFanMenuOnPage(page, "https://onlyfans.com/my/chats/chat/7", { action: "list", name: "VIP" });
    assert.equal(picked.ok, true);
    assert.equal(await page.locator("#state").innerText(), "lista VIP");
    const discount = await runFanMenuOnPage(page, "https://onlyfans.com/my/chats/chat/7", { action: "discount", percent: 20 });
    assert.equal(discount.ok, true);
    assert.equal(await page.locator("#state").innerText(), "descuento 20");
    const blocked = await runFanMenuOnPage(page, "https://onlyfans.com/my/chats/chat/7", { action: "block" });
    assert.equal(blocked.ok, true);
    assert.equal(await page.locator("#state").innerText(), "bloqueado");
  } finally {
    await browser.close();
  }
});
