import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { chromium } from "playwright";
import { boxRemainder, composeChat, createPendingNet, isMessageWrite } from "../send/compose.ts";
import { navigationNote, pruneSendFailures, publicChatUrl, readFooterNodes, threadIdKind, writeSendFailure } from "../send/targets.ts";
import { startFixture } from "./fixture-site.ts";

test("el id del hilo es el withUser y la url pública no lleva query", () => {
  assert.equal(threadIdKind("28022478", "28022478"), "withUser");
  assert.equal(threadIdKind("interno", null), "interno");
  assert.equal(publicChatUrl("https://onlyfans.com/my/chats/chat/28022478?token=sekret"), "https://onlyfans.com/my/chats/chat/28022478");
  const note = navigationNote(
    "https://onlyfans.com/my/chats/chat/28022478",
    "https://onlyfans.com/my/chats/chat/28022478?appToken=no",
  );
  assert.equal(note.redirected, false);
  assert.equal(note.url, "https://onlyfans.com/my/chats/chat/28022478");
  assert.equal(navigationNote("https://onlyfans.com/my/chats/chat/1", "https://onlyfans.com/login").redirected, true);
});

test("la caja y el Send del DOM real envían y el volcado no copia el mensaje", async () => {
  const fixture = await startFixture();
  const browser = await chromium.launch({ headless: true });
  const logs = await mkdtemp(path.join(tmpdir(), "fanlink-send-log-"));
  try {
    const context = await browser.newContext();
    await context.addCookies([
      { name: "sess", value: "ok-1", url: fixture.origin },
      { name: "auth_id", value: "42", url: fixture.origin },
    ]);
    const sent = await composeChat(context, {
      chatsUrl: `${fixture.origin}/my/chats`,
      siteId: "onlyfans",
      threadKey: "9",
      fanKey: "9",
      accountUserId: "42",
      body: "texto real",
      priceCents: 500,
      typeDelayMs: 0,
      confirmMs: 8_000,
    });
    assert.equal(sent.messageId, "300");
    assert.equal(fixture.composed[0]?.body, "texto real");
    assert.equal(fixture.composed[0]?.price, "5.00");

    const page = await context.newPage();
    await page.goto(`${fixture.origin}/my/chats/chat/9`, { waitUntil: "domcontentloaded" });
    const nodes = await page.evaluate(readFooterNodes);
    const dump = JSON.stringify(nodes);
    assert.equal(dump.includes("mensaje secreto del fan"), false);
    assert.equal(nodes.some((node) => node.atAttr === "chat_input" && node.placeholder === "Type a message..."), true);
    assert.equal(nodes.some((node) => node.atAttr === "send_btn"), true);
    assert.equal(nodes.some((node) => node.atAttr === "price_btn"), true);
    await page.close();

    const lines: string[] = [];
    const previous = console.info;
    console.info = (...args: unknown[]) => {
      lines.push(args.map((item) => String(item)).join(" "));
      previous(...args);
    };
    try {
      const stuck = await composeChat(context, {
        chatsUrl: `${fixture.origin}/my/chats`,
        siteId: "onlyfans",
        threadKey: "8",
        fanKey: "8",
        accountUserId: "42",
        body: "no sale",
        priceCents: null,
        typeDelayMs: 0,
        confirmMs: 600,
        settleMs: 400,
      });
      assert.equal(stuck.messageId, null);
      assert.equal(lines.filter((line) => line.includes("[fanlink:send] inicio")).length, 1);
      const dumpLine = lines.find((line) => line.includes("volcado="));
      assert.ok(dumpLine);
      const jsonPath = dumpLine.split("volcado=")[1]?.split(" ")[0] ?? "";
      const pngPath = dumpLine.split("captura=")[1]?.trim() ?? "";
      const dump = await readFile(jsonPath, "utf8");
      assert.equal(dump.includes("mensaje secreto del fan"), false);
      assert.equal(dump.includes("chat_input"), true);
      assert.equal(dump.includes("\"[]\""), false);
      const png = await stat(pngPath);
      assert.ok(png.size > 32);
      assert.equal(lines.some((line) => line.includes("muestra=")), false);
    } finally {
      console.info = previous;
    }
  } finally {
    await browser.close();
    await fixture.close();
    await rm(logs, { recursive: true, force: true });
  }
});

test("un click que vacía la caja tarde no se reenvía con Enter", async () => {
  const sent = await sendOnce("6", "tarde");
  assert.equal(sent.composed, 1);
  assert.equal(sent.messageId, "300");
  assert.equal(sent.enters, 0);
});

test("marcar como leído no es el POST que envía el mensaje", () => {
  assert.equal(isMessageWrite("POST", "https://onlyfans.com/api2/v2/chats/412874293/messages"), true);
  assert.equal(isMessageWrite("POST", "https://onlyfans.com/api2/v2/chats/412874293/messages/read"), false);
  assert.equal(isMessageWrite("PUT", "https://onlyfans.com/api2/v2/chats/412874293/messages"), false);
  assert.equal(isMessageWrite("GET", "https://onlyfans.com/api2/v2/chats/412874293/messages"), false);
});

test("un 400 al marcar leído no tira el envío", async () => {
  const sent = await sendOnce("3", "muy tarde");
  assert.equal(sent.messageId, "300");
  assert.equal(sent.reason, null);
  assert.equal(sent.lines.some((line) => line.includes("estado=no-enviado")), false);
});

test("un salto de línea no cuenta como texto que quedó en la caja", () => {
  assert.equal(boxRemainder(""), "vacio");
  assert.equal(boxRemainder("\n"), "10");
  assert.equal(boxRemainder("hola"), "texto");
});

test("el POST lento de mensajes se espera y un 500 no queda como enviado", async () => {
  const posted = await sendOnce("5", "hola");
  assert.equal(posted.composed, 1);
  assert.equal(posted.messageId, "300");
  assert.equal(posted.enters, 0);
  assert.equal(posted.lines.some((line) => line.includes("post=200")), true);
  assert.equal(posted.lines.some((line) => line.includes("resto=10")), true);

  const rejected = await sendOnce("0", "hola");
  assert.equal(rejected.messageId, null);
  assert.equal(rejected.reason, "no enviado");
  assert.equal(rejected.lines.some((line) => line.includes("post=500")), true);
  assert.equal(rejected.lines.some((line) => line.includes("volcado=")), true);
  assert.equal(rejected.lines.some((line) => line.includes("estado=pendiente")), false);
});

test("el contador de red se vacía al cerrar o al caducar", () => {
  const pending = createPendingNet(1_000);
  const first = {};
  pending.start(first, 0);
  assert.equal(pending.count(500), 1);
  assert.equal(pending.openedSince(0, 500), true);
  pending.finish(first, 500);
  assert.equal(pending.count(500), 0);
  const stuck = {};
  pending.start(stuck, 0);
  assert.equal(pending.count(1_000), 0);
  assert.equal(pending.openedSince(0, 1_000), false);
  pending.start(stuck, 2_000);
  pending.reset();
  assert.equal(pending.count(2_000), 0);
});

test("una petición que no termina no pulsa Enter", async () => {
  const sent = await sendOnce("1", "colgado");
  assert.equal(sent.composed, 1);
  assert.equal(sent.enters, 0);
  assert.equal(sent.messageId, null);
});

test("si la red confirma después de 12 s no se pulsa Enter", async () => {
  const sent = await sendOnce("2", "tardisimo");
  assert.equal(sent.composed, 1);
  assert.equal(sent.messageId, "300");
  assert.equal(sent.enters, 0);
});

test("la caja que se vacía después de 3 s no se reenvía", async () => {
  const sent = await sendOnce("3", "muy tarde");
  assert.equal(sent.composed, 1);
  assert.equal(sent.messageId, "300");
  assert.equal(sent.enters, 0);
});

test("si el click no sale, Enter se prueba una sola vez", async () => {
  const sent = await sendOnce("4", "solo enter", 500);
  assert.equal(sent.composed, 1);
  assert.equal(sent.messageId, "300");
  assert.equal(sent.enters, 1);
});

test("la captura recorta el chat y no la pestaña entera", async () => {
  const browser = await chromium.launch({ headless: true });
  const dir = await mkdtemp(path.join(tmpdir(), "fanlink-send-clip-"));
  try {
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
    await page.setContent(`<style>body{margin:0}.b-chat{position:absolute;left:40px;top:80px;width:200px;height:120px;background:#123}</style><div style="height:2000px"></div><div class="b-chat"></div>`);
    const files = await writeSendFailure(page, dir);
    assert.ok(files.png);
    const png = await readFile(files.png);
    assert.equal(png.readUInt32BE(16), 200);
    assert.equal(png.readUInt32BE(20), 120);
    await page.close();
  } finally {
    await browser.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("sin el chat no se guarda captura", async () => {
  const fixture = await startFixture();
  const browser = await chromium.launch({ headless: true });
  const dir = await mkdtemp(path.join(tmpdir(), "fanlink-send-shot-"));
  try {
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
    await page.goto(`${fixture.origin}/tall`, { waitUntil: "domcontentloaded" });
    const files = await writeSendFailure(page, dir);
    assert.equal(files.png, null);
    const names = await readdir(dir);
    assert.equal(names.some((name) => name.endsWith(".png")), false);
    await page.close();
  } finally {
    await browser.close();
    await fixture.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("los volcados viejos se borran y no se guardan más de 20", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "fanlink-send-prune-"));
  try {
    const old = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    await writeFile(path.join(dir, "send-fail-old.json"), "{}");
    await utimes(path.join(dir, "send-fail-old.json"), old, old);
    for (let index = 0; index < 21; index += 1) {
      await writeFile(path.join(dir, `send-fail-${String(index).padStart(2, "0")}.json`), "{}");
    }
    await pruneSendFailures(dir);
    assert.equal(await readFile(path.join(dir, "send-fail-20.json"), "utf8"), "{}");
    await assert.rejects(readFile(path.join(dir, "send-fail-old.json"), "utf8"));
    await assert.rejects(readFile(path.join(dir, "send-fail-00.json"), "utf8"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

async function sendOnce(threadKey: string, body: string, settleMs?: number): Promise<{ composed: number; messageId: string | null; enters: number; reason: string | null; lines: string[] }> {
  const fixture = await startFixture();
  const browser = await chromium.launch({ headless: true });
  const lines: string[] = [];
  const previous = console.info;
  console.info = (...args: unknown[]) => {
    lines.push(args.map((item) => String(item)).join(" "));
    previous(...args);
  };
  try {
    const context = await browser.newContext();
    await context.addCookies([
      { name: "sess", value: "ok-1", url: fixture.origin },
      { name: "auth_id", value: "42", url: fixture.origin },
    ]);
    const sent = await composeChat(context, {
      chatsUrl: `${fixture.origin}/my/chats`,
      siteId: "onlyfans",
      threadKey,
      fanKey: threadKey,
      accountUserId: "42",
      body,
      priceCents: null,
      typeDelayMs: 0,
      ...(settleMs == null ? {} : { settleMs }),
      confirmMs: 4_000,
    });
    return {
      composed: fixture.composed.length,
      messageId: sent.messageId,
      enters: lines.filter((line) => line.includes("[fanlink:send] enter")).length,
      reason: sent.reason,
      lines,
    };
  } finally {
    console.info = previous;
    await browser.close();
    await fixture.close();
  }
}
