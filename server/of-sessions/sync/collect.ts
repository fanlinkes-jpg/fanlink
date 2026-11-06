import type { BrowserContext, Page } from "playwright";
import { isCurrentUserResponseUrl, isLoginChallengeUrl, jsonUrlWithoutSecrets, usersMeVerdict } from "../identity.ts";
import { messages } from "../messages.ts";
import type { SiteAdapter } from "../sessions/site.ts";
import {
  classifyJsonPath,
  outcomeFromParsed,
  parseEarningsDom,
  parseEarningsJson,
  parseFansDom,
  parseFansJson,
  parseTransactions,
  preferOutcome,
  takeContiguousTransactions,
  readFailureReason,
  type SectionOutcome,
  type TxCursor,
  type EarningRow,
  type FanRow,
  type TransactionRow,
} from "./parse.ts";
import { fanPageUrls, logApiResponse, logSection, sectionWaitMs, settleUntil, TRANSACTIONS_GRACE_MS } from "./wait-for-data.ts";

export { takeContiguousTransactions };

export type CollectedRead = {
  earnings: EarningRow[];
  fans: FanRow[];
  transactions: TransactionRow[];
  fansComplete?: boolean;
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
  options: { paceMs: number; waitMs: number; includeEarnings: boolean; now?: Date; sinceTx?: TxCursor | null },
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
    fanScrollStable: false,
    earningsOutcome: "pending" as SectionOutcome,
    fansOutcome: "pending" as SectionOutcome,
    earningsDataUrl: null as string | null,
    fansDataUrl: null as string | null,
    earningsSeenAt: null as number | null,
  };
  const pending: Promise<void>[] = [];
  const onResponse = (response: { url(): string; status(): number; headers(): Record<string, string>; text(): Promise<string> }) => {
    pending.push(observe(response, notes, now));
  };
  context.on("response", onResponse);
  try {
    const page = await context.newPage();
    if (site.id === "onlyfans") {
      await warmOnlyFans(page, site, options, notes, pending);
    } else {
      if (options.includeEarnings && site.earningsUrl) {
        await openPage(
          page,
          site.earningsUrl,
          options,
          notes,
          pending,
          false,
          site,
          () => notes.earningsOutcome === "ok" || notes.earningsOutcome === "empty",
        );
        logSection("lectura", "ingresos", page.url(), notes.earningsDataUrl, notes.earnings.length, ` movimientos=${notes.transactions.length}`);
      }
      await openFanPages(page, site, options, notes, pending);
    }
    const markers = await page.evaluate(readSyncMarkers).catch(() => null);
    if (options.includeEarnings && notes.earnings.length === 0 && markers) {
      notes.earnings = parseEarningsDom(markers.earnings, now);
      if (notes.earnings.length > 0) notes.earningsOutcome = preferOutcome(notes.earningsOutcome, "ok");
    }
    if (notes.fans.length === 0 && markers) {
      notes.fans = parseFansDom(markers.fans, now);
      if (notes.fans.length > 0) {
        notes.fansOutcome = preferOutcome(notes.fansOutcome, "ok");
        notes.fanScrollStable = true;
      }
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
          earnings: options.includeEarnings ? notes.earningsOutcome : "ok",
          fans: notes.fansOutcome,
          jsonPaths: notes.paths,
        });
    if (reason) {
      console.info(`[fanlink:lectura] ${reason}${notes.paths.length ? ` | json: ${notes.paths.join(", ")}` : ""}`);
    }
    return {
      earnings: notes.earnings,
      fans: notes.fans.slice(0, 5000),
      transactions: takeContiguousTransactions(notes.transactions, options.sinceTx ?? null),
      fansComplete: fanListSettled({
        stable: notes.fanScrollStable,
        count: notes.fans.length,
        hadError:
          loginRequired ||
          notes.redirected ||
          notes.fansRedirect ||
          notes.fansOutcome === "pending" ||
          notes.fansOutcome === "changed",
      }),
      reason,
      jsonPaths: notes.paths,
      earningsCaptured: notes.earningsOutcome === "ok" || notes.earningsOutcome === "empty",
      fansCaptured: notes.fansOutcome === "ok" || notes.fansOutcome === "empty",
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
  notes: ReadNotes,
  pending: Promise<void>[],
): Promise<void> {
  const homeRedirect = await openPage(page, site.probeUrl, options, notes, pending, false, site, () => notes.sawLoggedIn);
  if (homeRedirect) notes.redirected = true;
  if (!notes.sawLoggedIn || notes.loginRequired) {
    notes.loginRequired = true;
    return;
  }
  notes.redirected = false;
  if (options.includeEarnings && site.earningsUrl) {
    notes.earningsRedirect = await openPage(page, site.earningsUrl, options, notes, pending, true, site, () => earningsSettled(notes, site.id));
    logSection(
      "lectura",
      "ingresos",
      page.url(),
      notes.earningsDataUrl,
      notes.earnings.length,
      ` movimientos=${notes.transactions.length}`,
    );
  }
  await openFanPages(page, site, options, notes, pending);
}

export const FAN_LIST_CAP = 5000;

/** El scroll solo cuenta como lista completa si el recuento dejó de crecer antes del tope. */
export function fanListSettled(input: { stable: boolean; count: number; hadError: boolean }): boolean {
  if (input.hadError || !input.stable) return false;
  if (input.count >= FAN_LIST_CAP) return false;
  return true;
}

function pageLoginReason(earnings: boolean, fans: boolean): string {
  if (earnings && fans) return "las páginas de ingresos y fans pidieron login";
  if (earnings) return "la página de ingresos pidió login";
  return "la página de fans pidió login";
}

type ReadNotes = {
  paths: string[];
  earnings: EarningRow[];
  fans: FanRow[];
  transactions: TransactionRow[];
  redirected: boolean;
  loginRequired: boolean;
  sawLoggedIn: boolean;
  earningsRedirect: boolean;
  fansRedirect: boolean;
  fanScrollStable: boolean;
  earningsOutcome: SectionOutcome;
  fansOutcome: SectionOutcome;
  earningsDataUrl: string | null;
  fansDataUrl: string | null;
  earningsSeenAt: number | null;
};

function earningsSettled(notes: ReadNotes, siteId: string): boolean {
  if (notes.earningsOutcome !== "ok" && notes.earningsOutcome !== "empty") return false;
  if (siteId !== "onlyfans") return true;
  if (notes.transactions.length > 0) return true;
  if (notes.earningsSeenAt == null) return false;
  return Date.now() - notes.earningsSeenAt >= TRANSACTIONS_GRACE_MS;
}

async function openFanPages(
  page: Page,
  site: SiteAdapter,
  options: { paceMs: number; waitMs: number },
  notes: ReadNotes,
  pending: Promise<void>[],
): Promise<void> {
  const urls = fanPageUrls(site.id, site.subscribersUrl);
  for (let index = 0; index < urls.length; index += 1) {
    if (notes.fansOutcome === "ok" || notes.fansOutcome === "empty") break;
    const url = urls[index] ?? "";
    const slice = index === 0 ? sectionWaitMs(site.id, options.waitMs) : site.id === "onlyfans" ? 15_000 : 0;
    if (slice <= 0) break;
    const redirected = await openPage(
      page,
      url,
      options,
      notes,
      pending,
      true,
      site,
      () => notes.fansOutcome === "ok" || notes.fansOutcome === "empty",
      slice,
    );
    notes.fansRedirect = redirected;
    logSection("lectura", "fans", page.url(), notes.fansDataUrl, notes.fans.length);
    if (redirected) break;
  }
}

async function loginVisible(page: Page, site: SiteAdapter): Promise<boolean> {
  if (site.isLoginUrl(page.url())) return true;
  if (!site.loggedOutSelector) return false;
  const login = await page.locator(`${site.loggedOutSelector}:visible`).count().catch(() => 0);
  return login > 0;
}

async function openPage(
  page: Page,
  url: string,
  options: { paceMs: number; waitMs: number },
  notes: ReadNotes,
  pending: Promise<void>[],
  scroll: boolean,
  site: SiteAdapter,
  ready: () => boolean,
  budgetMs?: number,
): Promise<boolean> {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => undefined);
  if (await loginVisible(page, site)) {
    notes.redirected = true;
    return true;
  }
  await settleUntil({
    budgetMs: budgetMs ?? sectionWaitMs(site.id, options.waitMs),
    paceMs: options.paceMs,
    ready,
    scroll,
    wheel: async (dy) => {
      await page.mouse.wheel(0, dy).catch(() => undefined);
      await page.mouse.move(480 + (dy % 80), 320).catch(() => undefined);
    },
    pause: delay,
    drain: () => drain(pending),
  });
  const redirected = await loginVisible(page, site);
  if (redirected) notes.redirected = true;
  if (scroll && !redirected && (notes.fansOutcome === "ok" || notes.fansOutcome === "empty")) {
    if (notes.fansOutcome === "empty" || notes.fans.length === 0) {
      notes.fanScrollStable = true;
    } else {
      let previous = notes.fans.length;
      let stable = false;
      for (let step = 0; step < 12; step += 1) {
        await page.mouse.wheel(0, 900).catch(() => undefined);
        await delay(options.paceMs);
        await drain(pending);
        const seen = notes.fans.length;
        if (seen === previous || seen >= FAN_LIST_CAP) {
          stable = seen < FAN_LIST_CAP;
          break;
        }
        previous = seen;
      }
      notes.fanScrollStable = stable;
    }
  }
  return redirected;
}

async function observe(
  response: { url(): string; status(): number; headers(): Record<string, string>; text(): Promise<string> },
  notes: ReadNotes,
  now: Date,
): Promise<void> {
  let url = "";
  try {
    url = response.url();
    logApiResponse("lectura", url, response.status());
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
    const safe = jsonUrlWithoutSecrets(url);
    if (type && !type.includes("json") && !type.includes("text")) {
      rememberSection(notes, kind, safe, "changed");
      return;
    }
    const raw = await response.text();
    if (raw.length > 1_500_000) {
      rememberSection(notes, kind, safe, "changed");
      return;
    }
    const parsed = JSON.parse(raw) as unknown;
    if (kind === "earnings") {
      const rows = parseEarningsJson(parsed, now);
      const txs = parseTransactions(parsed, now);
      notes.earnings.push(...rows);
      notes.transactions.push(...txs);
      rememberSection(notes, kind, safe, outcomeFromParsed(rows.length + txs.length, parsed));
      return;
    }
    const fans = parseFansJson(parsed, now);
    notes.fans.push(...fans);
    rememberSection(notes, kind, safe, outcomeFromParsed(fans.length, parsed));
  } catch {
    if (!url) return;
    const kind = classifyJsonPath(url);
    if (kind === "other") return;
    rememberSection(notes, kind, jsonUrlWithoutSecrets(url), "changed");
  }
}

function rememberSection(
  notes: ReadNotes,
  kind: "earnings" | "fans",
  path: string | null,
  outcome: SectionOutcome,
): void {
  if (kind === "earnings") {
    notes.earningsOutcome = preferOutcome(notes.earningsOutcome, outcome);
    if (!notes.earningsDataUrl && path) notes.earningsDataUrl = path;
    if (notes.earningsSeenAt == null && (outcome === "ok" || outcome === "empty")) notes.earningsSeenAt = Date.now();
    return;
  }
  notes.fansOutcome = preferOutcome(notes.fansOutcome, outcome);
  if (!notes.fansDataUrl && path) notes.fansDataUrl = path;
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
