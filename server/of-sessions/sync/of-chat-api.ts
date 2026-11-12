import { BROWSER_FINGERPRINT } from "../sessions/browser-factory.ts";
import { domainMatches, isCookieUnexpired, type StorageStateFile } from "../sessions/storage-state.ts";
import { parseChatList, parseChatMessages, parsePreviewMessages, type ChatMessage, type ChatThread } from "./chats.ts";
import { loadSignRules, signOnlyfans, type SignRules } from "./of-sign.ts";

const HOST = "onlyfans.com";

export type SignedChats = {
  threads: ChatThread[];
  messages: ChatMessage[];
  reason: string | null;
};

export function sessionForApi(state: StorageStateFile, nowMs: number): { cookie: string; userId: string; xBc: string } | { reason: string } {
  const cookies = state.cookies.filter((cookie) => domainMatches(cookie.domain, HOST) && isCookieUnexpired(cookie.expires, nowMs));
  const userId = cookies.find((cookie) => cookie.name === "auth_id")?.value ?? "";
  if (!userId || !cookies.some((cookie) => cookie.name === "sess")) return { reason: "la sesión guardada no tiene auth_id y sess" };
  const stored = state.origins.flatMap((origin) => origin.localStorage);
  const xBc = stored.find((item) => item.name === "bcTokenSha" || item.name === "fp")?.value
    ?? cookies.find((cookie) => cookie.name === "fp" || cookie.name === "x-bc")?.value
    ?? "";
  if (!xBc) return { reason: "falta la huella x-bc de la sesión" };
  return { cookie: cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; "), userId, xBc };
}

export function signedHeaders(rules: SignRules, pathWithQuery: string, auth: { cookie: string; userId: string; xBc: string }, timeSeconds: number): Record<string, string> {
  const signed = signOnlyfans(rules, pathWithQuery, auth.userId, timeSeconds);
  const headers: Record<string, string> = {
    accept: "application/json, text/plain, */*",
    "app-token": rules.appToken,
    cookie: auth.cookie,
    sign: signed.sign,
    time: signed.time,
    "user-agent": BROWSER_FINGERPRINT.userAgent,
    "x-bc": auth.xBc,
    referer: "https://onlyfans.com/",
  };
  if (!rules.removeHeaders.includes("user-id")) headers["user-id"] = auth.userId;
  return headers;
}

export async function fetchSignedChats(state: StorageStateFile, deps: {
  fetch: typeof fetch;
  now: () => number;
}): Promise<SignedChats> {
  const auth = sessionForApi(state, deps.now());
  if ("reason" in auth) return { threads: [], messages: [], reason: auth.reason };
  const rules = await loadSignRules(deps.fetch, deps.now());
  const listPath = "/api2/v2/chats?limit=20&offset=0&skip_users=none&order=recent";
  const list = await getJson(deps.fetch, listPath, signedHeaders(rules, listPath, auth, Math.floor(deps.now() / 1000)));
  if (!list.ok) return { threads: [], messages: [], reason: list.reason };
  const threads = parseChatList(list.body, auth.userId);
  const messages = parsePreviewMessages(list.body);
  const extra: ChatMessage[] = [];
  for (const thread of threads.slice(0, 5)) {
    const path = `/api2/v2/chats/${encodeURIComponent(thread.threadKey)}/messages?limit=10&order=desc&skip_users=all`;
    const page = await getJson(deps.fetch, path, signedHeaders(rules, path, auth, Math.floor(deps.now() / 1000)));
    if (!page.ok) continue;
    extra.push(...parseChatMessages(page.body, thread.threadKey, thread.fanKey, auth.userId));
  }
  return { threads, messages: [...messages, ...extra], reason: null };
}

async function getJson(fetchImpl: typeof fetch, pathWithQuery: string, headers: Record<string, string>): Promise<{ ok: true; body: unknown } | { ok: false; reason: string }> {
  const response = await fetchImpl(`https://onlyfans.com${pathWithQuery}`, { headers });
  if (response.status === 401 || response.status === 400) return { ok: false, reason: `OnlyFans ha rechazado la firma (${response.status})` };
  if (!response.ok) return { ok: false, reason: `OnlyFans respondió ${response.status}` };
  try {
    return { ok: true, body: await response.json() };
  } catch {
    return { ok: false, reason: "OnlyFans no devolvió JSON" };
  }
}
