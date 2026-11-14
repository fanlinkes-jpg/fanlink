import type { NotificationCounts, ParsedNotification } from "../../../src/lib/notifications.ts";
import {
  NOTIFICATION_LIST_LIMIT,
  newTagsCountOf,
  parseNotificationCounts,
  parseNotificationPayload,
} from "../../../src/lib/notifications.ts";
import { awaitAccountGap, REQUEST_GAP_MS } from "./api-list-pace.ts";
import { backoffDelayMs } from "./backoff.ts";
import { notificationMarkReadGate } from "../send/gate.ts";
import type { SendAccount } from "../send/gate.ts";
import { sessionForApi, signedHeaders, type SignedChatDeps } from "./of-chat-api.ts";
import { loadSignRules } from "./of-sign.ts";
import type { StorageStateFile } from "../sessions/storage-state.ts";

/**
 * Centro de notificaciones del cliente web (bundle 202610091632-c45cc0ac3f,
 * módulo 202600). Catálogo:
 * https://github.com/BlackPhoenixSlo/Opensoursed_infloww/blob/c78dfad8442aee7b0fc47c4fea69e345093694f3/docs/plans/of-manager-api-catalogue.md
 *
 * - GET /api2/v2/users/notifications?limit&format=infinite
 *   respuesta {list, hasMore}. Sin skip_users: con skip_users=all OnlyFans
 *   quita el user (XcelerateManagement api/poller.py).
 * - GET /api2/v2/users/notifications/count  sin query, {all, <type>: n}
 * - GET /api2/v2/users/me  solo para newTagsCount (Etiquetas). Si no viene, null.
 * - POST /api2/v2/users/notifications/read            marca todas, sin cuerpo
 * - POST /api2/v2/users/notifications/read/{type}    marca un tipo, sin cuerpo
 *   El catálogo (202600, símbolos B y F) dice que el cuerpo es none y la
 *   respuesta es {counters} o {success, counters}.
 *
 * Tipos de pastilla, leídos del bundle en ofMirrorFeedsNotifications.ts:
 * subscribed, purchases, tip, commented, mentioned, favorited,
 * message (Promociones), deactivated_media (OnlyFans).
 *
 * user-id y el id del hash salen de signedUserId: id real en todas las rutas.
 * Primero la lista. Un 400 o un fallo del contador no tiran la lista.
 * Un 429 corta la pasada y deja retryAfter.
 */

export type NotificationRouteName = "lista" | "contador" | "etiquetas" | "marcar";

export type NotificationRouteLog = {
  route: NotificationRouteName;
  status: number | null;
  motivo: string;
  count: number;
};

export type CollectedNotifications = {
  items: ParsedNotification[];
  counts: NotificationCounts | null;
  reason: string | null;
  motivo: string;
  countMotivo: string | null;
  routes: NotificationRouteLog[];
  jsonPaths: string[];
  captured: boolean;
  loginRequired?: boolean;
  alreadyRunning?: boolean;
  sessionRejected: boolean;
  signatureRejected: boolean;
  status: number | null;
  retryAfterMs: number;
};

export type MarkNotificationsResult = {
  wrote: boolean;
  motivo: string;
  counts: NotificationCounts | null;
  routes: NotificationRouteLog[];
  retryAfterMs: number;
  sessionRejected: boolean;
  signatureRejected: boolean;
};

export type SignedNotificationDeps = SignedChatDeps;

export const NOTIFICATION_LIST_PATH = `/api2/v2/users/notifications?limit=${NOTIFICATION_LIST_LIMIT}&format=infinite`;
export const NOTIFICATION_COUNT_PATH = "/api2/v2/users/notifications/count";
export const NOTIFICATION_ME_PATH = "/api2/v2/users/me";
export const NOTIFICATION_MARK_ALL_PATH = "/api2/v2/users/notifications/read";

export function notificationMarkTypePath(type: string): string {
  return `/api2/v2/users/notifications/read/${encodeURIComponent(type)}`;
}

export function notificationListPath(): string {
  return NOTIFICATION_LIST_PATH;
}

export function notificationCountPath(): string {
  return NOTIFICATION_COUNT_PATH;
}

export function notificationLogLine(input: {
  creatorId: string;
  route: NotificationRouteName;
  count: number;
  motivo: string;
  status: number | null;
}): string {
  const status = input.status == null ? "" : String(input.status);
  return `[fanlink:notif] creator=${input.creatorId} ruta=${input.route} n=${input.count} motivo=${input.motivo} status=${status}`;
}

export async function fetchSignedNotifications(state: StorageStateFile, deps: SignedNotificationDeps): Promise<CollectedNotifications> {
  const auth = sessionForApi(state, deps.now());
  if ("reason" in auth) return emptyRead(auth.reason, "no se pudo leer", false, false, null, 0, []);
  const rules = deps.rules ?? await loadSignRules(deps.fetch, deps.now());
  const routes: NotificationRouteLog[] = [];
  let lastRequestAt = 0;
  const request = async (path: string, method: "GET" | "POST" = "GET"): Promise<JsonPage> => {
    await pace(deps, lastRequestAt, (at) => {
      lastRequestAt = at;
    });
    const page = await getJson(deps.fetch, path, signedHeaders(rules, path, auth, deps.now()), deps.now(), method);
    lastRequestAt = deps.now();
    return page;
  };

  const listPage = await request(NOTIFICATION_LIST_PATH);
  routes.push(routeLog("lista", listPage, listPage.ok ? parseNotificationPayload(listPage.body, { accountUserId: auth.userId }).length : 0));
  if (halt(listPage)) return stoppedRead(listPage, [], routes);

  const items = parseNotificationPayload(listPage.body, { accountUserId: auth.userId });
  const countPage = await request(NOTIFICATION_COUNT_PATH);
  const counts = countPage.ok ? parseNotificationCounts(countPage.body) : null;
  routes.push(routeLog("contador", countPage, counts?.all ?? 0));
  if (countPage.retryAfterMs > 0) {
    return {
      ...stoppedRead(countPage, items, routes),
      captured: true,
      motivo: "ok",
      reason: null,
      countMotivo: countPage.motivo,
      signatureRejected: false,
      sessionRejected: false,
    };
  }

  const countMotivo = countPage.ok && counts ? null : countPage.ok ? "no se pudo leer" : countPage.motivo;
  const nextCounts = countPage.ok ? counts : null;

  const mePage = await request(NOTIFICATION_ME_PATH);
  const tags = mePage.ok ? newTagsCountOf(mePage.body) : null;
  routes.push(routeLog("etiquetas", mePage, tags ?? 0));
  if (mePage.retryAfterMs > 0) {
    return {
      ...stoppedRead(mePage, items, routes),
      captured: true,
      counts: withTags(nextCounts, null),
      motivo: "ok",
      reason: null,
      countMotivo,
      signatureRejected: false,
      sessionRejected: false,
    };
  }
  const withTagCounts = nextCounts ? withTags(nextCounts, mePage.ok ? tags : nextCounts.tags) : null;
  const empty = items.length === 0 && withTagCounts?.all === 0;
  return {
    items,
    counts: withTagCounts,
    reason: empty ? "sin notificaciones" : null,
    motivo: empty ? "sin notificaciones" : "ok",
    countMotivo,
    routes,
    jsonPaths: [NOTIFICATION_LIST_PATH, NOTIFICATION_COUNT_PATH, NOTIFICATION_ME_PATH],
    captured: true,
    sessionRejected: false,
    signatureRejected: false,
    status: listPage.status,
    retryAfterMs: 0,
  };
}

export async function dispatchNotificationMark(input: {
  flag: string | undefined;
  allowlist: string | undefined;
  account: SendAccount;
  state: StorageStateFile;
  deps: SignedNotificationDeps;
  scope: { all: boolean; types: string[] };
}): Promise<MarkNotificationsResult> {
  const gate = notificationMarkReadGate(input.flag, input.allowlist, input.account);
  if (!gate.allowed) {
    return {
      wrote: false,
      motivo: "marcado apagado",
      counts: null,
      routes: [{ route: "marcar", status: null, motivo: "marcado apagado", count: 0 }],
      retryAfterMs: 0,
      sessionRejected: false,
      signatureRejected: false,
    };
  }
  return markSignedNotificationsRead(input.state, input.deps, input.scope);
}

/**
 * POST sin cuerpo. Luego relee el contador. Si el POST falla, no hay relectura
 * y counts queda null para no bajar el número a ciegas.
 */
export async function markSignedNotificationsRead(
  state: StorageStateFile,
  deps: SignedNotificationDeps,
  scope: { all: boolean; types: string[] },
): Promise<MarkNotificationsResult> {
  const auth = sessionForApi(state, deps.now());
  if ("reason" in auth) {
    return { wrote: false, motivo: "no se pudo leer", counts: null, routes: [], retryAfterMs: 0, sessionRejected: false, signatureRejected: false };
  }
  const rules = deps.rules ?? await loadSignRules(deps.fetch, deps.now());
  let lastRequestAt = 0;
  const routes: NotificationRouteLog[] = [];
  const request = async (path: string, method: "GET" | "POST"): Promise<JsonPage> => {
    await pace(deps, lastRequestAt, (at) => {
      lastRequestAt = at;
    });
    const page = await getJson(deps.fetch, path, signedHeaders(rules, path, auth, deps.now()), deps.now(), method);
    lastRequestAt = deps.now();
    return page;
  };
  const paths = scope.all ? [NOTIFICATION_MARK_ALL_PATH] : scope.types.map((type) => notificationMarkTypePath(type));
  for (const path of paths) {
    const page = await request(path, "POST");
    routes.push(routeLog("marcar", page, 0));
    if (!page.ok) {
      return {
        wrote: false,
        motivo: page.motivo,
        counts: null,
        routes,
        retryAfterMs: page.retryAfterMs,
        sessionRejected: page.sessionRejected,
        signatureRejected: page.signatureRejected,
      };
    }
  }
  const countPage = await request(NOTIFICATION_COUNT_PATH, "GET");
  const counts = countPage.ok ? parseNotificationCounts(countPage.body) : null;
  routes.push(routeLog("contador", countPage, counts?.all ?? 0));
  if (!countPage.ok || !counts) {
    return {
      wrote: true,
      motivo: countPage.ok ? "no se pudo leer" : countPage.motivo,
      counts: null,
      routes,
      retryAfterMs: countPage.retryAfterMs,
      sessionRejected: false,
      signatureRejected: false,
    };
  }
  return { wrote: true, motivo: "ok", counts, routes, retryAfterMs: 0, sessionRejected: false, signatureRejected: false };
}

function withTags(counts: NotificationCounts | null, tags: number | null): NotificationCounts | null {
  if (!counts && tags == null) return null;
  return {
    all: counts?.all ?? null,
    subscriptions: counts?.subscriptions ?? null,
    purchases: counts?.purchases ?? null,
    tips: counts?.tips ?? null,
    tags,
    comments: counts?.comments ?? null,
    mentions: counts?.mentions ?? null,
    likes: counts?.likes ?? null,
    promotions: counts?.promotions ?? null,
    onlyfans: counts?.onlyfans ?? null,
  };
}

function halt(page: JsonPage): boolean {
  return page.sessionRejected || page.signatureRejected || page.retryAfterMs > 0 || !page.ok;
}

function stoppedRead(page: JsonPage, items: ParsedNotification[], routes: NotificationRouteLog[]): CollectedNotifications {
  return {
    items,
    counts: null,
    reason: page.reason,
    motivo: page.motivo,
    countMotivo: page.motivo,
    routes,
    jsonPaths: routes.map(() => page.motivo),
    captured: false,
    loginRequired: page.sessionRejected,
    sessionRejected: page.sessionRejected,
    signatureRejected: page.signatureRejected,
    status: page.status,
    retryAfterMs: page.retryAfterMs,
  };
}

function routeLog(route: NotificationRouteName, page: JsonPage, count: number): NotificationRouteLog {
  return { route, status: page.status, motivo: page.motivo, count };
}

async function pace(deps: SignedNotificationDeps, lastRequestAt: number, remember: (at: number) => void): Promise<void> {
  const gap = deps.sleep ? (deps.minGapMs ?? REQUEST_GAP_MS) : 0;
  if (!deps.sleep || gap <= 0) return;
  if (deps.accountId) {
    await awaitAccountGap(deps.accountId, deps.now, deps.sleep, gap);
    remember(deps.now());
    return;
  }
  if (lastRequestAt > 0) {
    const wait = gap - (deps.now() - lastRequestAt);
    if (wait > 0) await deps.sleep(wait);
  }
  remember(deps.now());
}

function emptyRead(
  reason: string | null,
  motivo: string,
  sessionRejected: boolean,
  signatureRejected: boolean,
  status: number | null,
  retryAfterMs: number,
  routes: NotificationRouteLog[],
): CollectedNotifications {
  return {
    items: [],
    counts: null,
    reason,
    motivo,
    countMotivo: motivo,
    routes,
    jsonPaths: [],
    captured: false,
    loginRequired: sessionRejected,
    sessionRejected,
    signatureRejected,
    status,
    retryAfterMs,
  };
}

type JsonPage = {
  ok: boolean;
  body: unknown;
  reason: string;
  motivo: string;
  status: number;
  sessionRejected: boolean;
  signatureRejected: boolean;
  retryAfterMs: number;
};

async function getJson(
  fetchImpl: typeof fetch,
  pathWithQuery: string,
  headers: Record<string, string>,
  nowMs: number,
  method: "GET" | "POST",
): Promise<JsonPage> {
  const response = await fetchImpl(`https://onlyfans.com${pathWithQuery}`, { method, headers });
  if (response.status === 401) {
    return { ok: false, body: null, reason: "OnlyFans ha rechazado la sesión (401). Pulsa Reconectar.", motivo: "sesión caída", status: 401, sessionRejected: true, signatureRejected: false, retryAfterMs: 0 };
  }
  if (response.status === 400) {
    return { ok: false, body: null, reason: "OnlyFans rechazó la firma", motivo: "firma rechazada", status: 400, sessionRejected: false, signatureRejected: true, retryAfterMs: 0 };
  }
  if (response.status === 429) {
    return { ok: false, body: null, reason: "OnlyFans respondió 429", motivo: "no se pudo leer", status: 429, sessionRejected: false, signatureRejected: false, retryAfterMs: retryAfterMs(response, nowMs) };
  }
  if (!response.ok) {
    return { ok: false, body: null, reason: `OnlyFans respondió ${response.status}`, motivo: "no se pudo leer", status: response.status, sessionRejected: false, signatureRejected: false, retryAfterMs: 0 };
  }
  try {
    return { ok: true, body: await response.json(), reason: "", motivo: "ok", status: response.status, sessionRejected: false, signatureRejected: false, retryAfterMs: 0 };
  } catch {
    return { ok: false, body: null, reason: "OnlyFans no devolvió JSON", motivo: "no se pudo leer", status: response.status, sessionRejected: false, signatureRejected: false, retryAfterMs: 0 };
  }
}

function retryAfterMs(response: Response, nowMs: number): number {
  const header = response.headers.get("retry-after");
  const cap = 30 * 60_000;
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(Math.round(seconds * 1000), cap);
    const at = Date.parse(header);
    if (Number.isFinite(at)) return Math.min(Math.max(0, at - nowMs), cap);
  }
  return backoffDelayMs(0);
}
