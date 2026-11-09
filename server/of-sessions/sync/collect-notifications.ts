import type { BrowserContext, Page } from "playwright";
import { closeIfIdle } from "../live/pages.ts";
import {
  kindFromNotificationType,
  mergeNotifications,
  NOTIFICATION_TYPE_READS,
  notificationScrolls,
  parseNotificationPayload,
  redactedNotificationUrl,
  type NotificationKind,
  type ParsedNotification,
} from "../../../src/lib/notifications.ts";
import { logApiResponse } from "./wait-for-data.ts";

export type NotificationSite = {
  id: string;
  probeUrl: string;
  notificationsUrl?: string;
  isLoginUrl(url: string): boolean;
};

export type CollectedNotifications = {
  items: ParsedNotification[];
  reason: string | null;
  jsonPaths: string[];
  captured: boolean;
  loginRequired?: boolean;
  alreadyRunning?: boolean;
};

type Notes = {
  paths: string[];
  items: ParsedNotification[];
  captured: boolean;
  redirected: boolean;
  loginRequired: boolean;
};

/**
 * Abre la página de notificaciones. El listener va antes de navegar.
 * No pide la API: solo lee el JSON que esa página solicita y, si no llega,
 * el marcador que la propia página haya dejado. Como mucho un desplazamiento.
 */
export async function collectNotifications(
  context: BrowserContext,
  site: NotificationSite,
  options: { paceMs: number; waitMs: number; scrolls?: number },
): Promise<CollectedNotifications> {
  if (!site.notificationsUrl) {
    return { items: [], reason: "sin página de notificaciones", jsonPaths: [], captured: false };
  }
  const notes: Notes = { paths: [], items: [], captured: false, redirected: false, loginRequired: false };
  const pending: Promise<void>[] = [];
  const onResponse = (response: { url(): string; status(): number; text(): Promise<string> }) => {
    pending.push(observe(response, notes));
  };
  context.on("response", onResponse);
  let page: Page | null = null;
  try {
    page = await context.newPage();
    await openAndWait(page, site.notificationsUrl, options.waitMs, pending, () => notes.captured);
    if (pageLooksLoggedOut(page.url(), site)) {
      return { items: [], reason: "redirigido a login", jsonPaths: notes.paths, captured: false, loginRequired: true };
    }
    const scrolls = notificationScrolls(options.scrolls ?? 1);
    if (scrolls > 0 && !notes.loginRequired) {
      await delay(options.paceMs);
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => undefined);
      await waitUntil(Math.min(options.waitMs, 4_000), pending, () => false);
    }
    if (!notes.captured) {
      const marker = await page.evaluate(readNotificationMarker).catch(() => null);
      const parsed = parseNotificationPayload(marker);
      if (parsed.length > 0) {
        notes.items = mergeNotifications(notes.items, parsed);
        notes.captured = true;
      }
    }
    const typed = await readNotificationTypes(page);
    if (typed.length > 0) {
      notes.items = replaceNotifications(notes.items, typed);
      notes.captured = true;
    }
    return {
      items: notes.items,
      reason: notes.captured ? null : "sin respuesta de notificaciones",
      jsonPaths: notes.paths,
      captured: notes.captured,
    };
  } finally {
    context.off("response", onResponse);
    if (page) await closeIfIdle(page);
    await Promise.allSettled(pending);
  }
}

async function observe(
  response: { url(): string; status(): number; text(): Promise<string> },
  notes: Notes,
): Promise<void> {
  const safe = redactedNotificationUrl(response.url());
  if (!safe) return;
  logApiResponse("lectura", safe, response.status());
  if (!notes.paths.includes(safe)) notes.paths.push(safe);
  if (response.status() < 200 || response.status() >= 300) return;
  let payload: unknown;
  try {
    payload = JSON.parse(await response.text());
  } catch {
    return;
  }
  const parsed = parseNotificationPayload(payload);
  if (parsed.length === 0) return;
  notes.items = mergeNotifications(notes.items, parsed);
  notes.captured = true;
}

async function openAndWait(
  page: Page,
  url: string,
  waitMs: number,
  pending: Promise<void>[],
  done: () => boolean,
): Promise<void> {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: Math.max(waitMs, 1_000) }).catch(() => undefined);
  await waitUntil(waitMs, pending, done);
}

async function waitUntil(waitMs: number, pending: Promise<void>[], done: () => boolean): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < waitMs) {
    await Promise.allSettled(pending.splice(0));
    if (done()) return;
    await delay(80);
  }
  await Promise.allSettled(pending.splice(0));
}

function pageLooksLoggedOut(url: string, site: NotificationSite): boolean {
  return site.isLoginUrl(url);
}

function readNotificationMarker(): unknown {
  const node = document.querySelector("#fanlink-notifications");
  if (!node?.textContent) return null;
  try {
    return JSON.parse(node.textContent);
  } catch {
    return null;
  }
}

function replaceNotifications(current: ParsedNotification[], incoming: ParsedNotification[]): ParsedNotification[] {
  const map = new Map(current.map((item) => [item.key, item]));
  for (const item of incoming) map.set(item.key, item);
  return [...map.values()];
}

/** Cada pestaña de OnlyFans es una petición distinta. Se lee en la página que ya está dentro. */
export async function readNotificationTypes(page: Page): Promise<ParsedNotification[]> {
  if (!page.url().includes("onlyfans.com/")) return [];
  const back = page.url();
  const already = back.includes("/my/notifications");
  try {
    return await readNotificationPage(page, !already);
  } finally {
    if (!already && page.url() !== back) {
      await page.goto(back, { waitUntil: "domcontentloaded", timeout: 20_000 }).catch(() => undefined);
    }
  }
}

const TAB_CLICKS: Array<[string, NotificationKind]> = [
  ["Suscripciones", "subscription"],
  ["Subscriptions", "subscription"],
  ["Compras", "ppv"],
  ["Purchases", "ppv"],
  ["Propinas", "tip"],
  ["Tips", "tip"],
  ["Etiquetas", "tag"],
  ["Tags", "tag"],
  ["Comentarios", "comment"],
  ["Comments", "comment"],
  ["Menciones", "mention"],
  ["Mentions", "mention"],
  ["Me gusta", "like"],
  ["Likes", "like"],
  ["Promociones", "promotion"],
  ["Promotions", "promotion"],
  ["OnlyFans", "system"],
];

async function readNotificationPage(page: Page, open: boolean): Promise<ParsedNotification[]> {
  const found: ParsedNotification[] = [];
  const pending: Promise<void>[] = [];
  let forced: NotificationKind | null = null;
  const onResponse = (response: { url(): string; status(): number; text(): Promise<string> }) => {
    if (!response.url().includes("/users/notifications")) return;
    const status = response.status();
    if (status < 200 || status >= 300) {
      console.info(`[fanlink:avisos] pagina status=${status}`);
      return;
    }
    const fromUrl = kindFromNotificationType(notificationTypeOf(response.url()));
    const kind = fromUrl ?? forced;
    pending.push(response.text().then((raw) => {
      let payload: unknown;
      try {
        payload = JSON.parse(raw);
      } catch {
        return;
      }
      const parsed = parseNotificationPayload(payload);
      for (const item of parsed) found.push(kind ? { ...item, kind } : item);
    }).catch(() => undefined));
  };
  page.on("response", onResponse);
  try {
    await openNotificationBell(page, open);
    for (const [label, kind] of TAB_CLICKS) {
      const tab = page.getByText(new RegExp(label, "i")).first();
      const visible = await tab.isVisible().catch(() => false);
      if (!visible) continue;
      forced = kind;
      console.info(`[fanlink:avisos] pestaña=${label}`);
      await tab.click({ timeout: 2_000 }).catch(() => undefined);
      await delay(800);
      for (let step = 0; step < 3; step += 1) {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => undefined);
        await delay(500);
      }
    }
    const fetched = await pullNotificationTypes(page);
    for (const item of fetched) found.push(item);
    await Promise.allSettled(pending.splice(0));
  } finally {
    page.off("response", onResponse);
  }
  const items = replaceNotifications([], found);
  const tags = items.filter((item) => item.kind === "tag").length;
  console.info(`[fanlink:avisos] leidos=${items.length} etiquetas=${tags}`);
  return items;
}

async function pullNotificationTypes(page: Page): Promise<ParsedNotification[]> {
  const types = NOTIFICATION_TYPE_READS.map((row) => row[0]);
  const payloads = await page.evaluate(async (wanted: string[]) => {
    const out: Array<{ type: string; status: number; body: unknown }> = [];
    for (const type of wanted) {
      try {
        const response = await fetch(`/api2/v2/users/notifications?limit=30&skip_users=none&format=infinite&type=${type}`, {
          credentials: "include",
          headers: { accept: "application/json" },
        });
        out.push({ type, status: response.status, body: response.ok ? await response.json() : null });
      } catch {
        out.push({ type, status: 0, body: null });
      }
    }
    return out;
  }, [...types]).catch(() => [] as Array<{ type: string; status: number; body: unknown }>);
  const items: ParsedNotification[] = [];
  for (const row of payloads) {
    const kind = kindFromNotificationType(row.type);
    const parsed = row.body == null ? [] : parseNotificationPayload(row.body);
    console.info(`[fanlink:avisos] ${row.type} status=${row.status} items=${parsed.length}`);
    if (!kind) continue;
    for (const item of parsed) items.push({ ...item, kind });
  }
  return items;
}

async function openNotificationBell(page: Page, open: boolean): Promise<void> {
  if (!open && page.url().includes("/my/notifications")) {
    await delay(600);
    return;
  }
  const opened = await page.evaluate(() => {
    const link = document.querySelector('a[href="/my/notifications"], a[href*="/my/notifications"]') as HTMLElement | null;
    if (link) {
      link.click();
      return "campana";
    }
    const button = [...document.querySelectorAll("a, button")].find((node) => {
      const label = `${node.getAttribute("aria-label") || ""} ${node.getAttribute("title") || ""}`;
      return /notification|notificacion/i.test(label);
    }) as HTMLElement | undefined;
    if (button) {
      button.click();
      return "boton";
    }
    return "";
  }).catch(() => "");
  console.info(`[fanlink:avisos] abrir=${opened || "directo"}`);
  if (!opened) {
    await page.goto("https://onlyfans.com/my/notifications", { waitUntil: "domcontentloaded", timeout: 20_000 }).catch(() => undefined);
  }
  await delay(1_500);
}

function notificationTypeOf(url: string): string | null {
  try {
    return new URL(url).searchParams.get("type");
  } catch {
    return null;
  }
}

function delay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}
