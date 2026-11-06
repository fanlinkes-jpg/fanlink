import { mkdir, writeFile } from "node:fs/promises";
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

export async function writeSendFailure(page: Page, dir = "logs"): Promise<{ json: string; png: string }> {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  await mkdir(dir, { recursive: true });
  const nodes = await page.evaluate(readFooterNodes).catch(() => []);
  const json = path.join(dir, `send-fail-${stamp}.json`);
  const png = path.join(dir, `send-fail-${stamp}.png`);
  await writeFile(json, JSON.stringify(nodes, null, 2));
  const size = page.viewportSize() ?? { width: 1280, height: 800 };
  const top = Math.floor(size.height * 0.55);
  await page.screenshot({
    path: png,
    clip: { x: 0, y: top, width: size.width, height: Math.max(1, size.height - top) },
  }).catch(() => undefined);
  return { json, png };
}
