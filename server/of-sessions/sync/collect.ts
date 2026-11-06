import type { BrowserContext, Page } from "playwright";
import { isCurrentUserResponseUrl, isLoginChallengeUrl, jsonUrlWithoutSecrets, usersMeVerdict } from "../identity.ts";
import { messages } from "../messages.ts";
import type { SiteAdapter } from "../sessions/site.ts";
import {
  classifyJsonPath,
  parseEarningsDom,
  parseEarningsJson,
  parseFansDom,
  parseFansJson,
  parseTransactions,
  readFailureReason,
  type EarningRow,
  type FanRow,
  type TransactionRow,
} from "./parse.ts";

export type CollectedRead = {
  earnings: EarningRow[];
  fans: FanRow[];
  transactions: TransactionRow[];
  reason: string | null;
  jsonPaths: string[];
  earningsCaptured: boolean;
  fansCaptured: boolean;
  loginRequired?: boolean;
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
  options: { paceMs: number; waitMs: number; includeEarnings: boolean; now?: Date; sinceTx?: string | null },
): Promise<CollectedRead> {
  const now = options.now ?? new Date();
  const notes = {
    paths: [] as string[],
    earnings: [] as EarningRow[],
    fans: [] as FanRow[],
    transactions: [] as TransactionRow[],
    redirected: false,
    loginRequired: false,
    sawLoggedIn: false,
    earningsRedirect: false,
    fansRedirect: false,
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
    if (site.id === "onlyfans") {
      await warmOnlyFans(page, site, options, notes, pending);
    } else {
      if (options.includeEarnings && site.earningsUrl) {
        await openPage(page, site.earningsUrl, options, notes, pending, false, site);
      }
      if (site.subscribersUrl) {
        await openPage(page, site.subscribersUrl, options, notes, pending, true, site);
      }
    }
    const markers = await page.evaluate(readSyncMarkers).catch(() => null);
    if (options.includeEarnings && notes.earnings.length === 0 && markers) {
      notes.earnings = parseEarningsDom(markers.earnings, now);
    }
    if (notes.fans.length === 0 && markers) {
      notes.fans = parseFansDom(markers.fans, now);
    }
    const loginRequired = site.id === "onlyfans" && !notes.sawLoggedIn && (notes.loginRequired || notes.redirected);
    const pageLogin = notes.sawLoggedIn && (notes.earningsRedirect || notes.fansRedirect);
    const reason = loginRequired
      ? messages.loginRequired
      : pageLogin
        ? pageLoginReason(notes.earningsRedirect, notes.fansRedirect)
        : readFailureReason({
          redirected: notes.redirected,
          wantEarnings: options.includeEarnings,
          earningsUrl: notes.earningsUrl,
          earningsRows: notes.earnings.length > 0,
          fansUrl: notes.fansUrl,
          fansRows: notes.fans.length > 0,
          jsonPaths: notes.paths,
        });
    if (reason) {
      console.info(`[fanlink:lectura] ${reason}${notes.paths.length ? ` | json: ${notes.paths.join(", ")}` : ""}`);
    }
    return {
      earnings: notes.earnings,
      fans: notes.fans.slice(0, 200),
      transactions: notes.transactions.filter((row) => !options.sinceTx || row.occurredAt > options.sinceTx).slice(0, 400),
      reason,
      jsonPaths: notes.paths,
      earningsCaptured: notes.earnings.length > 0,
      fansCaptured: notes.fans.length > 0,
      loginRequired,
    };
  } finally {
    context.off("response", onResponse);
  }
}

/**
 * OnlyFans puede mandar /my/statements/earnings al login si el feed aún no
 * ha arrancado en ese perfil. Primero se abre la home y se espera un
 * users/me con username. Si esa respuesta es de invitado, no se abren
 * ingresos ni fans. Si el usuario está logueado y una de esas páginas
 * pide login, la sesión no se marca caducada: el fallo es de esa página.
 */
async function warmOnlyFans(
  page: Page,
  site: SiteAdapter,
  options: { paceMs: number; waitMs: number; includeEarnings: boolean },
  notes: {
    redirected: boolean;
    loginRequired: boolean;
    sawLoggedIn: boolean;
    earningsRedirect: boolean;
    fansRedirect: boolean;
  },
  pending: Promise<void>[],
): Promise<void> {
  const homeRedirect = await openPage(page, site.probeUrl, options, notes, pending, false, site);
  if (homeRedirect) notes.redirected = true;
  if (!notes.sawLoggedIn || notes.loginRequired) {
    notes.loginRequired = true;
    return;
  }
  notes.redirected = false;
  if (options.includeEarnings && site.earningsUrl) {
    notes.earningsRedirect = await openPage(page, site.earningsUrl, options, notes, pending, false, site);
  }
  if (site.subscribersUrl) {
    notes.fansRedirect = await openPage(page, site.subscribersUrl, options, notes, pending, true, site);
  }
}

function pageLoginReason(earnings: boolean, fans: boolean): string {
  if (earnings && fans) return "las páginas de ingresos y fans pidieron login";
  if (earnings) return "la página de ingresos pidió login";
  return "la página de fans pidió login";
}

async function openPage(
  page: Page,
  url: string,
  options: { paceMs: number; waitMs: number },
  notes: { redirected: boolean },
  pending: Promise<void>[],
  scroll: boolean,
  site: SiteAdapter,
): Promise<boolean> {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await Promise.race([
    page.waitForLoadState("networkidle", { timeout: options.waitMs }).catch(() => undefined),
    delay(options.waitMs),
  ]);
  await drain(pending);
  let redirected = site.isLoginUrl(page.url());
  const login = site.loggedOutSelector
    ? await page.locator(`${site.loggedOutSelector}:visible`).count().catch(() => 0)
    : 0;
  if (login > 0) redirected = true;
  if (redirected) notes.redirected = true;
  if (scroll && !redirected) {
    for (let step = 0; step < 3; step += 1) {
      await page.mouse.wheel(0, 700).catch(() => undefined);
      await delay(options.paceMs);
      await drain(pending);
    }
  }
  await delay(options.paceMs);
  await drain(pending);
  return redirected;
}

async function observe(
  response: { url(): string; headers(): Record<string, string>; text(): Promise<string> },
  notes: {
    paths: string[];
    earnings: EarningRow[];
    fans: FanRow[];
    transactions: TransactionRow[];
    earningsUrl: boolean;
    fansUrl: boolean;
    loginRequired: boolean;
    sawLoggedIn: boolean;
  },
  now: Date,
): Promise<void> {
  let url = "";
  try {
    url = response.url();
    if (isLoginChallengeUrl(url)) notes.loginRequired = true;
    const kind = classifyJsonPath(url);
    const type = (response.headers()["content-type"] ?? "").toLowerCase();
    const path = jsonUrlWithoutSecrets(url);
    const usersMe = isCurrentUserResponseUrl(url);
    if (path && (type.includes("json") || kind !== "other" || usersMe) && !notes.paths.includes(path) && notes.paths.length < 20) {
      notes.paths.push(path);
    }
    if (usersMe && (!type || type.includes("json") || type.includes("text"))) {
      const rawUser = await response.text();
      if (rawUser.length <= 1_500_000) {
        const verdict = usersMeVerdict(JSON.parse(rawUser) as unknown);
        if (verdict.kind === "logged_in") {
          notes.sawLoggedIn = true;
          notes.loginRequired = false;
        } else if (verdict.kind === "guest") {
          notes.sawLoggedIn = false;
          notes.loginRequired = true;
        }
      }
      return;
    }
    if (kind === "other") return;
    if (kind === "earnings") notes.earningsUrl = true;
    if (kind === "fans") notes.fansUrl = true;
    if (type && !type.includes("json") && !type.includes("text")) return;
    const raw = await response.text();
    if (raw.length > 1_500_000) return;
    const parsed = JSON.parse(raw) as unknown;
    if (kind === "earnings") {
      notes.earnings.push(...parseEarningsJson(parsed, now));
      notes.transactions.push(...parseTransactions(parsed, now));
    }
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
