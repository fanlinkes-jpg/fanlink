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

/** Una petición de chat que no termina no cuenta para siempre. */
export const PENDING_NET_TTL_MS = 60_000;

export function createPendingNet(ttlMs = PENDING_NET_TTL_MS) {
  const open = new Map<object, number>();
  return {
    start(key: object, now = Date.now()) {
      this.sweep(now);
      open.set(key, now);
    },
    finish(key: object, now = Date.now()) {
      this.sweep(now);
      open.delete(key);
    },
    sweep(now = Date.now()) {
      for (const [key, at] of open) {
        if (now - at >= ttlMs) open.delete(key);
      }
    },
    count(now = Date.now()) {
      this.sweep(now);
      return open.size;
    },
    openedSince(mark: number, now = Date.now()) {
      this.sweep(now);
      for (const at of open.values()) {
        if (at >= mark) return true;
      }
      return false;
    },
    reset() {
      open.clear();
    },
  };
}

/** El resto de la caja: vacío, códigos si solo hay blanco, o texto si queda el mensaje. */
export function boxRemainder(raw: string): string {
  if (raw.length === 0) return "vacio";
  if (raw.trim().length === 0) return [...raw].map((char) => String(char.charCodeAt(0))).join(",");
  return "texto";
}

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
  vaultTitles?: string[];
  scheduleAt?: string | null;
  tagHandle?: string | null;
  bold?: boolean;
  /** 0 en pruebas. En real, cada tecla espera un retardo humano. */
  typeDelayMs?: number | null;
  confirmMs?: number;
  /** Espera del primer click antes de probar Enter una sola vez. */
  settleMs?: number;
};

export type ComposeResult = {
  messageId: string | null;
  reason: string | null;
  /** El texto salió, pero la página no dio un id de OnlyFans. */
  awaitingId?: boolean;
};

/**
 * Abre el hilo, escribe en la caja y pulsa Send. No pide api2:
 * solo escucha el JSON o el WebSocket que la propia página recibe.
 */
export async function composeChat(context: BrowserContext, request: ComposeRequest): Promise<ComposeResult> {
  const page = await openWorkPage(context);
  const payloads: string[] = [];
  const pending = createPendingNet();
  const messagePosts: Array<{ status: number | null }> = [];
  const postOf = new Map<object, { status: number | null }>();
  const trackNet = (delta: number, request: { url(): string; method?: () => string }) => {
    const path = pathOf(request.url());
    if (!path.includes("message") && !path.includes("chat")) return;
    if (delta > 0) pending.start(request);
    else pending.finish(request);
  };
  const rememberPost = (request: { url(): string; method(): string }) => {
    if (!isMessageWrite(request.method(), request.url())) return;
    const post = { status: null as number | null };
    messagePosts.push(post);
    postOf.set(request, post);
  };
  page.on("request", (request) => {
    rememberPost(request);
    trackNet(1, request);
  });
  page.on("requestfinished", (request) => trackNet(-1, request));
  page.on("requestfailed", (request) => {
    const post = postOf.get(request);
    if (post && post.status == null) post.status = 0;
    trackNet(-1, request);
  });
  page.on("close", () => pending.reset());
  const onResponse = (response: { url(): string; status(): number; text(): Promise<string>; request?: () => object }) => {
    const post = response.request ? postOf.get(response.request()) : undefined;
    if (post && post.status == null) post.status = response.status();
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
  const net = {
    postOpen: () => messagePosts.some((post) => post.status == null),
    postStatus: () => {
      const done = messagePosts.filter((post) => post.status != null);
      return done.length === 0 ? null : done[done.length - 1]?.status ?? null;
    },
    postLabel: () => {
      const last = messagePosts[messagePosts.length - 1];
      if (!last) return "no";
      if (last.status == null) return "abierto";
      return String(last.status);
    },
  };
  let result: ComposeResult = { messageId: null, reason: "No se envió" };
  let payloadFrom = 0;
  try {
    const url = chatPageUrl(request.chatsUrl, request.threadKey, request.siteId);
    console.info(`[fanlink:send] inicio hilo=${request.threadKey} origen=${threadIdKind(request.threadKey, request.fanKey)}`);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    const landed = navigationNote(url, page.url());
    console.info(`[fanlink:send] navegado url=${landed.url} redirigido=${landed.redirected ? "si" : "no"}`);
    if (page.url() === "about:blank") {
      result = await giveUp("no se abrió el hilo");
      return result;
    }
    if (/\/login(?:\/|$)/i.test(new URL(page.url()).pathname)) {
      result = await giveUp("OnlyFans pide iniciar sesión: pulsa Reconectar");
      return result;
    }
    await page.locator(MESSAGE_LIST_SELECTOR).first().waitFor({ timeout: 20_000 }).catch(() => undefined);
    const box = await firstReady(page, COMPOSER_SELECTORS, 20_000);
    const roleBox = box ?? await roleTextbox(page);
    if (!roleBox) {
      result = await giveUp("no está la caja del chat");
      return result;
    }
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
      if (!opened) {
        result = await giveUp("No está el precio nativo");
        return result;
      }
    }
    if (request.files && request.files.length > 0) {
      const input = page.locator("input[type='file']").first();
      await input.setInputFiles(request.files);
    }
    const titles = [...(request.vaultTitles ?? []), ...(request.vaultTitle ? [request.vaultTitle] : [])]
      .map((title) => title.trim())
      .filter((title, index, all) => title && all.indexOf(title) === index);
    if (titles.length > 0) {
      const vault = page.locator("[data-fanlink-vault], button[aria-label='Add from media vault'], button[aria-label='Añadir del vault']").first();
      await vault.click();
      for (const title of titles) {
        await page.getByRole("button", { name: title, exact: true }).click();
      }
    }
    if (request.scheduleAt) {
      const schedule = page.locator("[data-fanlink-schedule], button[aria-label='Schedule your message'], button[aria-label='Programar tu mensaje']").first();
      await schedule.click();
      await page.locator("input[type='datetime-local']").first().fill(request.scheduleAt);
      await page.getByRole("button", { name: /^(Save|Guardar)$/ }).click();
    }
    const before = payloads.length;
    payloadFrom = before;
    const netAtClick = Date.now();
    const beforeDom = await messageCount(page);
    const send = await firstReady(page, SEND_SELECTORS, 8_000);
    if (!send) {
      result = await giveUp("no está el botón Send");
      return result;
    }
    const enabled = await waitEnabled(send, 4_000);
    if ((request.typeDelayMs ?? 1) > 0) await delay(280 + Math.floor(Math.random() * 220));
    console.info(`[fanlink:send] click disabled=${enabled ? "no" : "si"} dom=${beforeDom}`);
    if (enabled) await send.click({ timeout: 5_000 }).catch(() => undefined);
    const settleMs = request.settleMs ?? 12_000;
    const first = await watchSend(roleBox, page, payloads, before, request, beforeDom, settleMs, net);
    const rawBox = await boxText(roleBox);
    const afterDom = await messageCount(page);
    console.info(`[fanlink:send] despues caracteres=${rawBox.length} resto=${boxRemainder(rawBox)} dom=${afterDom} antes=${beforeDom} post=${net.postLabel()}`);
    result = await finishAttempt(first, roleBox, page, payloads, before, request, beforeDom, () => pending.openedSince(netAtClick), net);
    return result;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "No se envió";
    result = await giveUp(publicSendReason(reason));
    return result;
  } finally {
    const limit = Date.now() + 20_000;
    let quietSince: number | null = null;
    while (Date.now() < limit) {
      const seen = idFromPayloads(payloads, payloadFrom, request);
      if (seen) {
        result.messageId = seen;
        result.reason = null;
        result.awaitingId = false;
        break;
      }
      if (net.postOpen()) quietSince = null;
      else quietSince ??= Date.now();
      if (quietSince != null && Date.now() - quietSince >= 1_000) break;
      await delay(50);
    }
    const late = idFromPayloads(payloads, payloadFrom, request);
    if (late && !result.messageId) {
      result.messageId = late;
      result.reason = null;
      result.awaitingId = false;
    }
    if (result.messageId) {
      console.info(`[fanlink:send] confirmado via=json post=${net.postLabel()}`);
    } else if (result.awaitingId) {
      console.info(`[fanlink:send] estado=pendiente post=${net.postLabel()}`);
    } else {
      const files = await writeSendFailure(page).catch(() => null);
      const where = files ? ` volcado=${files.json} captura=${files.png ?? "no"}` : "";
      if (!result.reason) result.reason = "no enviado";
      console.info(`[fanlink:send] estado=no-enviado post=${net.postLabel()}${where}`);
    }
    page.off("response", onResponse);
    await page.close().catch(() => undefined);
  }

  async function giveUp(reason: string): Promise<ComposeResult> {
    const motivo = publicSendReason(reason);
    console.info(`[fanlink:send] error motivo=${motivo}`);
    return { messageId: null, reason: motivo };
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
  const flag = disabled == null ? "na" : disabled ? "si" : "no";
  console.info(`[fanlink:send] ${label} caracteres=${text.length} igual=${igual ? "si" : "no"} disabled=${flag} dom=${dom}`);
}

type SendWatch = { kind: "id"; id: string } | { kind: "visto" } | { kind: "no" };

type PostNet = {
  postOpen: () => boolean;
  postStatus: () => number | null;
  postLabel: () => string;
};

/** Espera al id o a que la burbuja deje de estar en envío. Una caja vacía no basta. */
async function watchSend(
  _box: Locator,
  page: Page,
  payloads: string[],
  from: number,
  request: ComposeRequest,
  beforeDom: number,
  timeoutMs: number,
  net: PostNet,
): Promise<SendWatch> {
  const started = Date.now();
  const hard = timeoutMs + 20_000;
  while (Date.now() - started <= timeoutMs || (net.postOpen() && Date.now() - started <= hard)) {
    const id = idFromPayloads(payloads, from, request);
    if (id) return { kind: "id", id };
    const status = net.postStatus();
    if (status != null && status >= 400 && !net.postOpen()) return { kind: "no" };
    const phase = await bubblePhase(page, beforeDom, request.body);
    if (!net.postOpen() && phase === "listo") {
      const late = idFromPayloads(payloads, from, request);
      if (late) return { kind: "id", id: late };
      return { kind: "visto" };
    }
    await delay(100);
  }
  const id = idFromPayloads(payloads, from, request);
  if (id) return { kind: "id", id };
  const status = net.postStatus();
  if (status != null && status >= 400) return { kind: "no" };
  if (!net.postOpen() && await bubblePhase(page, beforeDom, request.body) === "listo") return { kind: "visto" };
  if (status != null && status >= 200 && status < 300) return { kind: "visto" };
  return { kind: "no" };
}

async function finishAttempt(
  first: SendWatch,
  box: Locator,
  page: Page,
  payloads: string[],
  from: number,
  request: ComposeRequest,
  beforeDom: number,
  networkOpen: () => boolean,
  net: PostNet,
): Promise<ComposeResult> {
  if (first.kind === "id") return { messageId: first.id, reason: null };
  const status = net.postStatus();
  if (status != null && status >= 400) return { messageId: null, reason: "no enviado" };
  if (first.kind === "visto") {
    noteDomDecision(net);
    return { messageId: null, reason: null, awaitingId: true };
  }
  if ((await boxText(box)).trim()) {
    const missed = await clickMissed(box, page, payloads, from, request, beforeDom, () => networkOpen() || net.postOpen());
    const late = idFromPayloads(payloads, from, request);
    if (late) return { messageId: late, reason: null };
    if (!missed) {
      const phase = await bubblePhase(page, beforeDom, request.body);
      if (phase !== "no" || net.postOpen() || (status != null && status < 400)) {
        return { messageId: null, reason: null, awaitingId: true };
      }
      return { messageId: null, reason: "no enviado" };
    }
    if (!net.postOpen()) {
      console.info("[fanlink:send] enter");
      await box.press("Enter").catch(() => undefined);
      const second = await watchSend(box, page, payloads, from, request, beforeDom, request.confirmMs ?? 8_000, net);
      if (second.kind === "id") return { messageId: second.id, reason: null };
      if (second.kind === "visto") {
        noteDomDecision(net);
        return { messageId: null, reason: null, awaitingId: true };
      }
      const after = idFromPayloads(payloads, from, request);
      if (after) return { messageId: after, reason: null };
      if ((net.postStatus() ?? 0) >= 400) return { messageId: null, reason: "no enviado" };
    }
  }
  const late = idFromPayloads(payloads, from, request);
  if (late) return { messageId: late, reason: null };
  const phase = await bubblePhase(page, beforeDom, request.body);
  if (phase === "listo") noteDomDecision(net);
  if (phase !== "no" || net.postOpen()) return { messageId: null, reason: null, awaitingId: true };
  return { messageId: null, reason: "no enviado" };
}

/** Si el POST de envío no apareció, el DOM no basta para darlo por bueno en silencio. */
export function sendRouteWarning(postLabel: string): "ruta-desconocida" | null {
  return postLabel === "no" ? "ruta-desconocida" : null;
}

function noteDomDecision(net: PostNet): void {
  if (sendRouteWarning(net.postLabel()) == null) return;
  console.info("[fanlink:send] aviso=ruta-desconocida decision=dom");
}

async function bubblePhase(page: Page, beforeDom: number, body: string): Promise<"no" | "pending" | "listo"> {
  if (await messageCount(page) <= beforeDom || !(await threadHasBody(page, body))) return "no";
  const pending = await page.locator(".b-chat__item, .b-chat__message").last().evaluate((node) => {
    const classes = [node, ...node.querySelectorAll("*")].map((item) => String(item.className || "")).join(" ");
    return /sending|enviando|pending|unsended|not-sent|spinner|loading|clock/i.test(classes);
  }).catch(() => false);
  return pending ? "pending" : "listo";
}

/** Enter solo si la red y la burbuja confirman que el click no salió. */
async function clickMissed(
  box: Locator,
  page: Page,
  payloads: string[],
  from: number,
  request: ComposeRequest,
  beforeDom: number,
  networkOpen: () => boolean,
): Promise<boolean> {
  const drain = Date.now() + 20_000;
  while (Date.now() < drain && (networkOpen() || payloads.slice(from).some((item) => item === ""))) {
    if (idFromPayloads(payloads, from, request)) return false;
    await delay(100);
  }
  if (idFromPayloads(payloads, from, request)) return false;
  if (networkOpen() || payloads.slice(from).some((item) => item === "")) return false;
  const needle = request.body.trim();
  if (needle && payloads.slice(from).some((item) => item.includes(needle))) return false;
  if (!(await boxText(box)).trim()) return false;
  const dom = await messageCount(page);
  if (dom > beforeDom && await threadHasBody(page, request.body)) return false;
  return true;
}

function idFromPayloads(payloads: string[], from: number, request: ComposeRequest): string | null {
  for (const payload of payloads.slice(from)) {
    if (!payload) continue;
    const id = messageIdFromPayload(payload, request);
    if (id) return id;
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

/** Solo el POST que crea el mensaje. Marcar leído y el resto no cuentan. */
export function isMessageWrite(method: string, url: string): boolean {
  if (method.toUpperCase() !== "POST") return false;
  return /^\/api2\/v2\/chats\/[^/]+\/messages\/?$/.test(pathOf(url));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
