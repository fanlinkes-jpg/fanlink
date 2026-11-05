import type { BrowserContext, Page } from "playwright";
import { jsonUrlWithoutSecrets } from "../identity.ts";
import type { SiteAdapter } from "../sessions/site.ts";
import {
  classifyJsonPath,
  parseEarningsDom,
  parseEarningsJson,
  parseFansDom,
  parseFansJson,
  readFailureReason,
  type EarningRow,
  type FanRow,
} from "./parse.ts";

export type CollectedRead = {
  earnings: EarningRow[];
  fans: FanRow[];
  reason: string | null;
  jsonPaths: string[];
  earningsCaptured: boolean;
  fansCaptured: boolean;
  alreadyRunning?: boolean;
};

/**
 * Abre las páginas normales de estadísticas y fans. El listener va antes de
 * navegar. No pide esas rutas por su cuenta: solo lee lo que la página pide
 * y, si no hay JSON útil, los marcadores del DOM.
 */
export async function collectCreatorRead(
  context: BrowserContext,
  site: SiteAdapter,
  options: { paceMs: number; waitMs: number; includeEarnings: boolean; now?: Date },
): Promise<CollectedRead> {
  const now = options.now ?? new Date();
  const notes = {
    paths: [] as string[],
    earnings: [] as EarningRow[],
    fans: [] as FanRow[],
    redirected: false,
    earningsUrl: false,
    fansUrl: false,
  };
  const pending: Promise<void>[] = [];
  const onResponse = (response: { url(): string; headers(): Record<string, string>; text(): Promise<string> }) => {
    pending.push(observe(response, notes, now));
  };
  context.on("response", onResponse);
  try {
    const page = await context.newPage();
    if (options.includeEarnings && site.earningsUrl) {
      await openPage(page, site.earningsUrl, options, notes, pending, false, site);
    }
    if (site.subscribersUrl) {
      await openPage(page, site.subscribersUrl, options, notes, pending, true, site);
    }
    const markers = await page.evaluate(readSyncMarkers).catch(() => null);
    if (options.includeEarnings && notes.earnings.length === 0 && markers) {
      notes.earnings = parseEarningsDom(markers.earnings, now);
    }
    if (notes.fans.length === 0 && markers) {
      notes.fans = parseFansDom(markers.fans, now);
    }
    const reason = readFailureReason({
      redirected: notes.redirected,
      wantEarnings: options.includeEarnings,
      earningsUrl: notes.earningsUrl,
      earningsRows: notes.earnings.length > 0,
      fansUrl: notes.fansUrl,
      fansRows: notes.fans.length > 0,
      jsonPaths: notes.paths,
    });
    if (reason) console.info(`[fanlink:lectura] ${reason}`);
    return {
      earnings: notes.earnings,
      fans: notes.fans.slice(0, 200),
      reason,
      jsonPaths: notes.paths,
      earningsCaptured: notes.earnings.length > 0,
      fansCaptured: notes.fans.length > 0,
    };
  } finally {
    context.off("response", onResponse);
  }
}

async function openPage(
  page: Page,
  url: string,
  options: { paceMs: number; waitMs: number },
  notes: { redirected: boolean },
  pending: Promise<void>[],
  scroll: boolean,
  site: SiteAdapter,
): Promise<void> {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await Promise.race([
    page.waitForLoadState("networkidle", { timeout: options.waitMs }).catch(() => undefined),
    delay(options.waitMs),
  ]);
  await drain(pending);
  if (site.isLoginUrl(page.url())) notes.redirected = true;
  const login = site.loggedOutSelector ? await page.locator(site.loggedOutSelector).count().catch(() => 0) : 0;
  if (login > 0) notes.redirected = true;
  if (scroll && !notes.redirected) {
    for (let step = 0; step < 3; step += 1) {
      await page.mouse.wheel(0, 700).catch(() => undefined);
      await delay(options.paceMs);
      await drain(pending);
    }
  }
  await delay(options.paceMs);
  await drain(pending);
}

async function observe(
  response: { url(): string; headers(): Record<string, string>; text(): Promise<string> },
  notes: {
    paths: string[];
    earnings: EarningRow[];
    fans: FanRow[];
    earningsUrl: boolean;
    fansUrl: boolean;
  },
  now: Date,
): Promise<void> {
  let url = "";
  try {
    url = response.url();
    const kind = classifyJsonPath(url);
    const type = (response.headers()["content-type"] ?? "").toLowerCase();
    const path = jsonUrlWithoutSecrets(url);
    if (path && (type.includes("json") || kind !== "other") && !notes.paths.includes(path) && notes.paths.length < 20) {
      notes.paths.push(path);
    }
    if (kind === "other") return;
    if (kind === "earnings") notes.earningsUrl = true;
    if (kind === "fans") notes.fansUrl = true;
    if (type && !type.includes("json") && !type.includes("text")) return;
    const raw = await response.text();
    if (raw.length > 1_500_000) return;
    const parsed = JSON.parse(raw) as unknown;
    if (kind === "earnings") notes.earnings.push(...parseEarningsJson(parsed, now));
    if (kind === "fans") notes.fans.push(...parseFansJson(parsed, now));
  } catch {
    if (url && classifyJsonPath(url) === "earnings") notes.earningsUrl = true;
    if (url && classifyJsonPath(url) === "fans") notes.fansUrl = true;
  }
}

export function readSyncMarkers(): {
  earnings: Array<{ day: string; kind: string; amount: string; currency: string }>;
  fans: Array<{ id: string; handle: string; name: string; subscribed: string; status: string; spent: string }>;
} {
  const earnings: Array<{ day: string; kind: string; amount: string; currency: string }> = [];
  const fans: Array<{ id: string; handle: string; name: string; subscribed: string; status: string; spent: string }> = [];
  for (const node of document.querySelectorAll("[data-fanlink-earning]")) {
    earnings.push({
      day: node.getAttribute("data-day") ?? "",
      kind: node.getAttribute("data-kind") ?? "",
      amount: node.getAttribute("data-amount") ?? "",
      currency: node.getAttribute("data-currency") ?? "",
    });
  }
  for (const node of document.querySelectorAll("[data-fanlink-fan]")) {
    fans.push({
      id: node.getAttribute("data-id") ?? "",
      handle: node.getAttribute("data-handle") ?? "",
      name: node.getAttribute("data-name") ?? "",
      subscribed: node.getAttribute("data-subscribed") ?? "",
      status: node.getAttribute("data-status") ?? "",
      spent: node.getAttribute("data-spent") ?? "",
    });
  }
  return { earnings: earnings.slice(0, 120), fans: fans.slice(0, 200) };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function drain(pending: Promise<void>[]): Promise<void> {
  for (let turn = 0; turn < 5 && pending.length > 0; turn += 1) {
    const batch = pending.splice(0, pending.length);
    await Promise.all(batch);
  }
}
