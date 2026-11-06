import type { BrowserContext, Locator, Page } from "playwright";
import { openWorkPage } from "../sessions/work-page.ts";
import { chatPageUrl, parseChatMessages } from "../sync/chats.ts";
import { confirmedOwnMessage, humanTypeDelay, publicSendReason } from "./gate.ts";
import {
  COMPOSER_SELECTORS,
  MESSAGE_LIST_SELECTOR,
  PRICE_BUTTON_SELECTORS,
  PRICE_FIELD_SELECTORS,
  SEND_SELECTORS,
  navigationNote,
  threadIdKind,
  writeSendFailure,
} from "./targets.ts";

export type ComposeRequest = {
  chatsUrl: string;
  siteId: string;
  threadKey: string;
  fanKey: string | null;
  accountUserId: string | null;
  body: string;
  priceCents: number | null;
  files?: string[];
  vaultTitle?: string | null;
  scheduleAt?: string | null;
  tagHandle?: string | null;
  bold?: boolean;
  /** 0 en pruebas. En real, cada tecla espera un retardo humano. */
  typeDelayMs?: number | null;
  confirmMs?: number;
};

export type ComposeResult = { messageId: string | null; reason: string | null };

/**
 * Abre el hilo, escribe en la caja y pulsa Send. No pide api2:
 * solo escucha el JSON o el WebSocket que la propia página recibe.
 */
export async function composeChat(context: BrowserContext, request: ComposeRequest): Promise<ComposeResult> {
  const page = await openWorkPage(context);
  const payloads: string[] = [];
  const onResponse = (response: { url(): string; status(): number; text(): Promise<string> }) => {
    if (response.status() < 200 || response.status() >= 300) return;
    const path = pathOf(response.url());
    if (!path.includes("message") && !path.includes("chat")) return;
    payloads.push("");
    const index = payloads.length - 1;
    void response.text().then((text) => {
      if (text.length <= 1_500_000) payloads[index] = text;
    }).catch(() => undefined);
  };
  page.on("response", onResponse);
  page.on("websocket", (socket) => {
    socket.on("framereceived", (frame) => {
      const payload = typeof frame.payload === "string" ? frame.payload : frame.payload.toString("utf8");
      if (payload.length <= 1_500_000) payloads.push(payload);
    });
  });
  try {
    const url = chatPageUrl(request.chatsUrl, request.threadKey, request.siteId);
    console.info(`[fanlink:send] inicio hilo=${request.threadKey} origen=${threadIdKind(request.threadKey, request.fanKey)}`);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    const landed = navigationNote(url, page.url());
    console.info(`[fanlink:send] navegado url=${landed.url} redirigido=${landed.redirected ? "si" : "no"}`);
    if (page.url() === "about:blank") return await giveUp(page, "no se abrió el hilo");
    if (/\/login(?:\/|$)/i.test(new URL(page.url()).pathname)) {
      return await giveUp(page, "OnlyFans pide iniciar sesión: pulsa Reconectar");
    }
    await page.locator(MESSAGE_LIST_SELECTOR).first().waitFor({ timeout: 20_000 }).catch(() => undefined);
    const box = await firstReady(page, COMPOSER_SELECTORS, 20_000);
    const roleBox = box ?? await roleTextbox(page);
    if (!roleBox) return await giveUp(page, "no está la caja del chat");
    await roleBox.click();
    await typeBody(roleBox, request.body, request.typeDelayMs);
    const sendForLog = await firstReady(page, SEND_SELECTORS, 1_000);
    await logBox("escrito", roleBox, request.body, sendForLog, page);
    if (request.bold) {
      const format = page.locator("[data-fanlink-format], button[aria-label='Format text'], button[aria-label='Formato de texto']").first();
      await format.click();
      await page.locator("[data-fanlink-bold], button[aria-label='Negrita'], button[aria-label='Bold']").first().click();
    }
    if (request.tagHandle) {
      const tag = page.locator("[data-fanlink-tag], button[aria-label='Tag other creator'], button[aria-label='Etiquetar otra creadora']").first();
      await tag.click();
      await page.getByRole("button", { name: request.tagHandle.replace(/^@/, ""), exact: false }).first().click();
    }
    if (request.priceCents != null && request.priceCents > 0) {
      const opened = await setNativePrice(page, request.priceCents, request.typeDelayMs);
      if (!opened) return await giveUp(page, "No está el precio nativo");
    }
    if (request.files && request.files.length > 0) {
      const input = page.locator("input[type='file']").first();
      await input.setInputFiles(request.files);
    }
    if (request.vaultTitle) {
      const vault = page.locator("[data-fanlink-vault], button[aria-label='Add from media vault'], button[aria-label='Añadir del vault']").first();
      await vault.click();
      await page.getByRole("button", { name: request.vaultTitle, exact: true }).click();
    }
    if (request.scheduleAt) {
      const schedule = page.locator("[data-fanlink-schedule], button[aria-label='Schedule your message'], button[aria-label='Programar tu mensaje']").first();
      await schedule.click();
      await page.locator("input[type='datetime-local']").first().fill(request.scheduleAt);
      await page.getByRole("button", { name: /^(Save|Guardar)$/ }).click();
    }
    const before = payloads.length;
    const beforeDom = await messageCount(page);
    const send = await firstReady(page, SEND_SELECTORS, 8_000);
    if (!send) return await giveUp(page, "no está el botón Send");
    const enabled = await waitEnabled(send, 4_000);
    if ((request.typeDelayMs ?? 1) > 0) await delay(280 + Math.floor(Math.random() * 220));
    console.info(`[fanlink:send] click disabled=${enabled ? "no" : "si"} dom=${beforeDom}`);
    if (enabled) await send.click({ timeout: 5_000 }).catch(() => undefined);
    await delay(350);
    let afterText = await boxText(roleBox);
    let afterDom = await messageCount(page);
    if (afterText.trim() && afterDom <= beforeDom) {
      console.info("[fanlink:send] enter");
      await roleBox.press("Enter").catch(() => undefined);
      await delay(350);
      afterText = await boxText(roleBox);
      afterDom = await messageCount(page);
    }
    console.info(`[fanlink:send] despues caracteres=${afterText.length} dom=${afterDom} antes=${beforeDom}`);
    const messageId = await waitForOwnMessage(payloads, before, request, page, beforeDom);
    if (!messageId) return await giveUp(page, "No apareció el mensaje propio");
    console.info(`[fanlink:send] confirmado via=${messageId === "dom" ? "dom" : "json"}`);
    return { messageId, reason: null };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "No se envió";
    return await giveUp(page, publicSendReason(reason));
  } finally {
    page.off("response", onResponse);
    await page.close().catch(() => undefined);
  }
}

async function setNativePrice(page: Page, priceCents: number, typeDelayMs: number | null | undefined): Promise<boolean> {
  const button = await firstReady(page, PRICE_BUTTON_SELECTORS, 8_000);
  if (!button) return false;
  await button.click();
  const dialog = page.getByRole("dialog").last();
  await dialog.waitFor({ timeout: 8_000 });
  const field = await firstReady(dialog, PRICE_FIELD_SELECTORS, 4_000) ?? dialog.locator("input").first();
  await field.click();
  const dollars = (priceCents / 100).toFixed(2);
  const delayMs = typeDelayMs ?? 70;
  if (delayMs <= 0) await field.fill(dollars);
  else await field.pressSequentially(dollars, { delay: delayMs });
  await dialog.getByRole("button", { name: /^(Save|Guardar)$/ }).click();
  return true;
}

async function typeBody(box: Locator, body: string, typeDelayMs: number | null | undefined): Promise<void> {
  const delayMs = typeDelayMs === 0 ? 0 : (typeDelayMs ?? null);
  if (delayMs == null) {
    for (const char of body) {
      await box.pressSequentially(char, { delay: 0 });
      await delay(humanTypeDelay(Math.random));
    }
  } else {
    await box.pressSequentially(body, { delay: delayMs });
  }
  await box.evaluate((el) => {
    const data = el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement ? el.value : el.textContent ?? "";
    el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function boxText(box: Locator): Promise<string> {
  return box.evaluate((el) => {
    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) return el.value;
    return el instanceof HTMLElement ? el.innerText || el.textContent || "" : el.textContent || "";
  }).catch(() => "");
}

async function isDisabled(send: Locator): Promise<boolean> {
  return send.evaluate((el) => {
    if (el instanceof HTMLButtonElement || el instanceof HTMLInputElement) return el.disabled;
    return el.getAttribute("aria-disabled") === "true" || el.hasAttribute("disabled");
  }).catch(() => false);
}

async function waitEnabled(send: Locator, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    if (!(await isDisabled(send))) return true;
    await delay(150);
  }
  return !(await isDisabled(send));
}

async function messageCount(page: Page): Promise<number> {
  return page.locator(".b-chat__item, .b-chat__message").count().catch(() => 0);
}

async function logBox(label: string, box: Locator, body: string, send: Locator | null, page: Page): Promise<void> {
  const text = (await boxText(box)).replace(/\s+/g, " ").trim();
  const igual = text === body.trim();
  const disabled = send ? await isDisabled(send) : null;
  const dom = await messageCount(page);
  const muestra = igual ? "" : ` muestra=${text.slice(0, 24)}`;
  const flag = disabled == null ? "na" : disabled ? "si" : "no";
  console.info(`[fanlink:send] ${label} caracteres=${text.length} igual=${igual ? "si" : "no"} disabled=${flag} dom=${dom}${muestra}`);
}

async function waitForOwnMessage(payloads: string[], from: number, request: ComposeRequest, page: Page, beforeDom: number): Promise<string | null> {
  const budget = request.confirmMs ?? 12_000;
  const deadline = Date.now() + budget;
  while (Date.now() <= deadline) {
    for (const payload of payloads.slice(from)) {
      if (!payload) continue;
      const id = messageIdFromPayload(payload, request);
      if (id) return id;
    }
    const dom = await messageCount(page);
    if (dom > beforeDom && await threadHasBody(page, request.body)) return "dom";
    await delay(150);
  }
  return null;
}

async function threadHasBody(page: Page, body: string): Promise<boolean> {
  const needle = body.trim();
  if (!needle) return false;
  return page.locator(".b-chat__item, .b-chat__message").evaluateAll((nodes, expected) => (
    nodes.some((node) => (node.textContent ?? "").includes(expected))
  ), needle).catch(() => false);
}

function messageIdFromPayload(payload: string, request: ComposeRequest): string | null {
  try {
    const messages = parseChatMessages(JSON.parse(payload) as unknown, request.threadKey, request.fanKey, request.accountUserId);
    return confirmedOwnMessage(messages, request.body, request.priceCents)?.messageId ?? null;
  } catch {
    return null;
  }
}

function pathOf(raw: string): string {
  try {
    return new URL(raw).pathname.toLowerCase();
  } catch {
    return "";
  }
}

async function firstReady(root: Page | Locator, selectors: string[], timeoutMs: number): Promise<Locator | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    for (const selector of selectors) {
      const locator = root.locator(selector).first();
      if (await locator.count()) return locator;
    }
    await delay(200);
  }
  return null;
}

async function roleTextbox(page: Page): Promise<Locator | null> {
  const scoped = page.locator(".b-chat, .b-chat__form, form").getByRole("textbox").last();
  if (await scoped.count()) return scoped;
  const any = page.getByRole("textbox").last();
  if (await any.count()) return any;
  return null;
}

async function giveUp(page: Page, reason: string): Promise<ComposeResult> {
  const motivo = publicSendReason(reason);
  const files = await writeSendFailure(page).catch(() => null);
  const where = files ? ` volcado=${files.json} captura=${files.png ?? "no"}` : "";
  console.info(`[fanlink:send] error motivo=${motivo}${where}`);
  return { messageId: null, reason: motivo };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
