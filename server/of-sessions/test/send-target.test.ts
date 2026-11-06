import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { chromium } from "playwright";
import { composeChat } from "../send/compose.ts";
import { navigationNote, publicChatUrl, readFooterNodes, threadIdKind } from "../send/targets.ts";
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
    } finally {
      console.info = previous;
    }
  } finally {
    await browser.close();
    await fixture.close();
    await rm(logs, { recursive: true, force: true });
  }
});
