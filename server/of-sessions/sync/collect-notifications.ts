import type { BrowserContext, Page } from "playwright";
import { closeIfIdle } from "../live/pages.ts";
import {
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

/** Cada pestaña de OnlyFans es una petición distinta. La general no trae las etiquetas. */
export async function readNotificationTypes(page: Page): Promise<ParsedNotification[]> {
  if (!page.url().includes("onlyfans.com/")) return [];
  const types = NOTIFICATION_TYPE_READS.map((row) => row[0]);
  const payloads = await page.evaluate(async (wanted: string[]) => {
    const out: Array<{ type: string; body: unknown }> = [];
    for (const type of wanted) {
      try {
        const response = await fetch(`/api2/v2/users/notifications?type=${type}&limit=30&skip_users=all&format=infinite`, {
          credentials: "include",
          headers: { accept: "application/json" },
        });
        if (!response.ok) continue;
        out.push({ type, body: await response.json() });
      } catch {
        // El siguiente tipo sigue.
      }
    }
    return out;
  }, [...types]).catch(() => [] as Array<{ type: string; body: unknown }>);
  const kindByType = new Map<string, NotificationKind>(NOTIFICATION_TYPE_READS);
  const items: ParsedNotification[] = [];
  for (const row of payloads) {
    const kind = kindByType.get(row.type);
    if (!kind) continue;
    for (const item of parseNotificationPayload(row.body)) items.push({ ...item, kind });
  }
  return items;
}

function delay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}
