import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Page } from "playwright";

/** El id del hilo es el withUser de OnlyFans cuando coincide con el fan. */
export function threadIdKind(threadKey: string, fanKey: string | null): "withUser" | "interno" {
  if (fanKey && fanKey === threadKey) return "withUser";
  return "interno";
}

/** URL sin query ni hash. La query de OnlyFans lleva tokens. */
export function publicChatUrl(raw: string): string {
  try {
    const url = new URL(raw);
    return `${url.origin}${url.pathname}`;
  } catch {
    return "";
  }
}

export function navigationNote(asked: string, landed: string): { url: string; redirected: boolean } {
  const url = publicChatUrl(landed);
  let redirected = true;
  try {
    redirected = new URL(asked).pathname !== new URL(landed).pathname;
  } catch {
    redirected = true;
  }
  return { url, redirected };
}

export const MESSAGE_LIST_SELECTOR = [
  "[data-fanlink-history]",
  ".b-chat__messages",
  ".b-chat__messages-list",
  ".b-chat__item",
].join(", ");

export const COMPOSER_SELECTORS = [
  "[data-fanlink-composer]",
  "[at-attr='chat_input']",
  "textarea[placeholder*='Type a message' i]",
  "textarea[placeholder*='Escribe un mensaje' i]",
  ".b-chat__message-input textarea",
  "textarea.b-chat__message-input",
  ".b-chat__form textarea",
  ".b-chat textarea",
  ".b-chat [contenteditable='true']",
];

export const SEND_SELECTORS = [
  "[data-fanlink-send]",
  "[at-attr='send_btn']",
  ".b-chat__form [at-attr='submit_post']",
  "button.b-chat__btn-submit",
  ".b-chat__btn-submit",
  ".b-chat__form button[aria-label='Send' i]",
  ".b-chat__form button[aria-label='Enviar' i]",
  "button[aria-label='Send' i]",
  "button[aria-label='Enviar' i]",
];

export const PRICE_BUTTON_SELECTORS = [
  "[data-fanlink-price]",
  "[at-attr='price_btn']",
  "[at-attr='set_price']",
  "button[aria-label='Price' i]",
  "button[aria-label='Message price' i]",
  "button[aria-label='Precio' i]",
];

export const PRICE_FIELD_SELECTORS = [
  "[data-fanlink-amount]",
  "[at-attr='price_input']",
  "[role='dialog'] input",
];

export type FooterNode = {
  tag: string;
  id: string;
  className: string;
  name: string;
  placeholder: string;
  role: string;
  atAttr: string;
  aria: Record<string, string>;
  data: Record<string, string>;
};

/** Solo estructura del pie. No copia el texto de los mensajes. */
export function readFooterNodes(): FooterNode[] {
  const height = window.innerHeight || 800;
  const nodes = [...document.querySelectorAll("input, textarea, button, [contenteditable='true']")];
  return nodes.flatMap((node) => {
    if (!(node instanceof HTMLElement)) return [];
    const box = node.getBoundingClientRect();
    if (box.bottom < height * 0.4 && box.height > 0) return [];
    const aria: Record<string, string> = {};
    const data: Record<string, string> = {};
    for (const attr of node.attributes) {
      const value = attr.value.slice(0, 80);
      if (attr.name.startsWith("aria-")) aria[attr.name] = value;
      if (attr.name.startsWith("data-")) data[attr.name] = value;
    }
    return [{
      tag: node.tagName.toLowerCase(),
      id: node.id.slice(0, 80),
      className: String(node.className).slice(0, 160),
      name: (node.getAttribute("name") ?? "").slice(0, 80),
      placeholder: (node.getAttribute("placeholder") ?? "").slice(0, 80),
      role: (node.getAttribute("role") ?? "").slice(0, 40),
      atAttr: (node.getAttribute("at-attr") ?? "").slice(0, 80),
      aria,
      data,
    }];
  });
}

/** HTML del chat sin el texto de los mensajes. Corre dentro de la página. */
export function readChatHtml(): string {
  const root = document.querySelector(".b-chat") ?? document.body;
  const clone = root.cloneNode(true);
  if (!(clone instanceof HTMLElement)) return "";
  clone.querySelectorAll("script, style, noscript, iframe").forEach((node) => node.remove());
  const messageRoots = [...clone.querySelectorAll(".b-chat__messages, .b-chat__messages-list, .b-chat__item, .b-chat__message")];
  const walker = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT);
  const texts: Text[] = [];
  while (walker.nextNode()) texts.push(walker.currentNode as Text);
  for (const text of texts) {
    const parent = text.parentElement;
    const inMessage = parent ? messageRoots.some((node) => node.contains(parent)) : false;
    if (inMessage || (text.textContent ?? "").trim().length > 40) text.textContent = "";
  }
  for (const el of [clone, ...clone.querySelectorAll("*")]) {
    if (!(el instanceof Element)) continue;
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      const keep = name === "class" || name === "id" || name === "at-attr" || name === "placeholder" || name === "name" || name === "type" || name === "role" || name === "disabled" || name.startsWith("aria-") || name.startsWith("data-");
      if (!keep) el.removeAttribute(attr.name);
      else if (attr.value.length > 120) el.setAttribute(attr.name, attr.value.slice(0, 120));
    }
  }
  return clone.outerHTML.slice(0, 180_000);
}

const SEND_FAIL_KEEP = 20;
const SEND_FAIL_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Borra volcados de más de una semana y deja como mucho 20 pares. */
export async function pruneSendFailures(dir = "logs", now = Date.now()): Promise<void> {
  const names = await readdir(dir).catch(() => [] as string[]);
  const rows = await Promise.all(names.filter((name) => /^send-fail-.+\.(json|png)$/.test(name)).map(async (name) => {
    const full = path.join(dir, name);
    const info = await stat(full).catch(() => null);
    return info ? { full, mtime: info.mtimeMs, json: name.endsWith(".json") } : null;
  }));
  const live = rows.filter((row): row is { full: string; mtime: number; json: boolean } => row != null);
  const stale = live.filter((row) => now - row.mtime > SEND_FAIL_MAX_AGE_MS);
  const fresh = live.filter((row) => now - row.mtime <= SEND_FAIL_MAX_AGE_MS).sort((left, right) => left.mtime - right.mtime);
  const jsons = fresh.filter((row) => row.json);
  const extra = jsons.slice(0, Math.max(0, jsons.length - SEND_FAIL_KEEP));
  const drop = new Set<string>([
    ...stale.map((row) => row.full),
    ...extra.flatMap((row) => [row.full, row.full.replace(/\.json$/, ".png")]),
  ]);
  await Promise.all([...drop].map((full) => rm(full, { force: true })));
}

export async function writeSendFailure(page: Page, dir = "logs"): Promise<{ json: string; png: string | null }> {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  await mkdir(dir, { recursive: true });
  const html = await page.evaluate(readChatHtml).catch((error: unknown) => (
    `<!-- ${error instanceof Error ? error.message.slice(0, 160) : "sin html"} -->`
  ));
  const json = path.join(dir, `send-fail-${stamp}.json`);
  const png = path.join(dir, `send-fail-${stamp}.png`);
  await writeFile(json, JSON.stringify({ html }, null, 2));
  const chat = page.locator(".b-chat").first();
  if (await chat.count() === 0) {
    await pruneSendFailures(dir);
    return { json, png: null };
  }
  try {
    const box = await chat.boundingBox().catch(() => null);
    const viewport = page.viewportSize();
    if (!box || !viewport || box.width <= 1 || box.height <= 1) {
      await pruneSendFailures(dir);
      return { json, png: null };
    }
    const x = Math.max(0, Math.min(box.x, viewport.width - 1));
    const y = Math.max(0, Math.min(box.y, viewport.height - 1));
    const width = Math.max(1, Math.min(box.width, viewport.width - x));
    const height = Math.max(1, Math.min(box.height, viewport.height - y));
    await page.screenshot({ path: png, type: "png", fullPage: false, clip: { x, y, width, height } });
    const info = await stat(png);
    await pruneSendFailures(dir);
    if (info.size < 32) return { json, png: null };
    return { json, png };
  } catch {
    await pruneSendFailures(dir);
    return { json, png: null };
  }
}
