import type { BrowserContext, Page } from "playwright";
import { openWorkPage } from "../sessions/work-page.ts";
import { chatPageUrl, parseChatMessages } from "../sync/chats.ts";
import { confirmedOwnMessage, humanTypeDelay, publicSendReason } from "./gate.ts";

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
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    if (page.url() === "about:blank") {
      return fail("no se abrió el hilo");
    }
    console.info("[fanlink:send] navegado");
    if (/\/login(?:\/|$)/i.test(new URL(page.url()).pathname)) {
      return fail("OnlyFans pide iniciar sesión: pulsa Reconectar");
    }
    const box = page.locator("[data-fanlink-composer], textarea[aria-label='Message'], .b-chat__message-input [contenteditable='true'], .b-chat__message-input textarea").last();
    await box.waitFor({ timeout: 8_000 });
    await box.click();
    await typeBody(page, request.body, request.typeDelayMs);
    console.info("[fanlink:send] escrito");
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
      if (!opened) return fail("No está el precio nativo");
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
    const send = page.locator("[data-fanlink-send], button[aria-label='Send'], button[aria-label='Enviar'], .b-chat__btn-submit").first();
    await send.waitFor({ timeout: 4_000 });
    if ((request.typeDelayMs ?? 1) > 0) await delay(280 + Math.floor(Math.random() * 220));
    console.info("[fanlink:send] click");
    await send.click();
    const messageId = await waitForOwnMessage(payloads, before, request);
    if (!messageId) return fail("No apareció el mensaje propio");
    console.info("[fanlink:send] confirmado");
    return { messageId, reason: null };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "No se envió";
    return fail(publicSendReason(reason));
  } finally {
    page.off("response", onResponse);
    await page.close().catch(() => undefined);
  }
}

async function setNativePrice(page: Page, priceCents: number, typeDelayMs: number | null | undefined): Promise<boolean> {
  const button = page.locator("[data-fanlink-price], button[aria-label='Price'], button[aria-label='Precio'], button[aria-label='Message price']").first();
  if (await button.count() === 0) return false;
  await button.click();
  const dialog = page.getByRole("dialog").last();
  await dialog.waitFor({ timeout: 4_000 });
  const field = dialog.locator("input").first();
  await field.click();
  const dollars = (priceCents / 100).toFixed(2);
  const delayMs = typeDelayMs ?? 70;
  if (delayMs <= 0) await field.fill(dollars);
  else await field.pressSequentially(dollars, { delay: delayMs });
  await dialog.getByRole("button", { name: /^(Save|Guardar)$/ }).click();
  return true;
}

async function typeBody(page: Page, body: string, typeDelayMs: number | null | undefined): Promise<void> {
  if (typeDelayMs === 0) {
    await page.keyboard.insertText(body);
    return;
  }
  for (const char of body) {
    await page.keyboard.type(char);
    await delay(typeDelayMs ?? humanTypeDelay(Math.random));
  }
}

async function waitForOwnMessage(payloads: string[], from: number, request: ComposeRequest): Promise<string | null> {
  const budget = request.confirmMs ?? 12_000;
  const deadline = Date.now() + budget;
  while (Date.now() <= deadline) {
    for (const payload of payloads.slice(from)) {
      if (!payload) continue;
      const id = messageIdFromPayload(payload, request);
      if (id) return id;
    }
    await delay(150);
  }
  return null;
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

function fail(reason: string): ComposeResult {
  const motivo = publicSendReason(reason);
  console.info(`[fanlink:send] error motivo=${motivo}`);
  return { messageId: null, reason: motivo };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
