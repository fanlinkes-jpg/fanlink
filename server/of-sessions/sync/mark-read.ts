/**
 * El único POST de marcar leído. Sale al abrir un hilo en el CRM, dentro de
 * `withAccountApi`, y solo si FANLINK_CHAT_MARK_READ=true y la cuenta está
 * en FANLINK_SEND_ALLOW_ACCOUNTS. La ruta masiva no se usa.
 */
import { accountOnAllowlist, type SendAccount } from "../send/gate.ts";
import { backoffDelayMs, pauseAccountFor } from "./backoff.ts";
import type { ReadSql } from "./store.ts";
import { awaitAccountGap, REQUEST_GAP_MS, withAccountApi } from "./api-list-pace.ts";
import { noteUnreadMarked } from "./chat-store.ts";
import { signedHeaders } from "./of-chat-api.ts";
import type { SignRules } from "./of-sign.ts";

const HOST = "https://onlyfans.com";
const jobs = new Map<string, Promise<MarkReadResult>>();

export type MarkReadResult = { posted: boolean; status: number | null };

export function clearMarkReadJobs(): void {
  jobs.clear();
}

export function markReadGate(
  flag: string | undefined,
  allowlist: string | undefined,
  account: SendAccount,
): { allowed: boolean } {
  if (flag !== "true") return { allowed: false };
  if (!accountOnAllowlist(allowlist, account)) return { allowed: false };
  return { allowed: true };
}

/** La cuenta no es la de la sesión, o está en pausa. No se manda el POST. */
export function markOpenRejected(identityState: string, paused: boolean): boolean {
  return identityState === "mismatch" || paused;
}

/** Ruta de un hilo. Nunca `/api2/v2/chats/mark-as-read`. */
export function markReadPath(threadKey: string): string | null {
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(threadKey) || threadKey === "mark-as-read") return null;
  return `/api2/v2/chats/${threadKey}/mark-as-read`;
}

export function markOpenedChat(input: {
  accountId: string;
  creatorId: string;
  threadKey: string;
  flag: string | undefined;
  allowlist: string | undefined;
  account: SendAccount;
  sql: ReadSql;
  fetch: typeof fetch;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  rules: SignRules;
  auth: { cookie: string; userId: string; xBc: string };
  log?: (line: string) => void;
  onSessionRejected?: () => Promise<void> | void;
}): Promise<MarkReadResult> {
  if (!markReadGate(input.flag, input.allowlist, input.account).allowed) return Promise.resolve({ posted: false, status: null });
  const path = markReadPath(input.threadKey);
  if (!path) return Promise.resolve({ posted: false, status: null });
  const key = `${input.accountId}\0${input.threadKey}`;
  const running = jobs.get(key);
  if (running) return running;
  const job = withAccountApi(input.accountId, () => postMark(input, path)).finally(() => {
    if (jobs.get(key) === job) jobs.delete(key);
  });
  jobs.set(key, job);
  return job;
}

async function postMark(
  input: {
    creatorId: string;
    threadKey: string;
    accountId: string;
    sql: ReadSql;
    fetch: typeof fetch;
    now: () => number;
    sleep: (ms: number) => Promise<void>;
    rules: SignRules;
    auth: { cookie: string; userId: string; xBc: string };
    log?: (line: string) => void;
    onSessionRejected?: () => Promise<void> | void;
  },
  path: string,
): Promise<MarkReadResult> {
  const rows = await input.sql.query<{ unread: number | string | null }>(
    "select unread from of_chat_thread where creator_id = $1 and thread_key = $2",
    [input.creatorId, input.threadKey],
  );
  if (!rows.length) return { posted: false, status: null };
  const unread = rows[0]?.unread;
  if (unread === 0 || unread === "0") return { posted: false, status: null };
  await awaitAccountGap(input.accountId, input.now, input.sleep, REQUEST_GAP_MS);
  const headers = signedHeaders(input.rules, path, input.auth, input.now());
  let status: number | null = null;
  let retryHeader: string | null = null;
  try {
    const response = await input.fetch(`${HOST}${path}`, { method: "POST", headers });
    status = response.status;
    retryHeader = response.headers.get("retry-after");
    await response.body?.cancel().catch(() => undefined);
  } catch {
    status = null;
  }
  input.log?.(`[fanlink:chat] creator=${input.creatorId} ruta=mark-as-read status=${status ?? "error"}`);
  if (status != null && status >= 200 && status < 300) {
    noteUnreadMarked(input.creatorId, input.threadKey, input.now());
    await input.sql.query(
      "update of_chat_thread set unread = 0 where creator_id = $1 and thread_key = $2",
      [input.creatorId, input.threadKey],
    );
    return { posted: true, status };
  }
  if (status === 401 || status === 429) {
    pauseAccountFor(input.accountId, String(status), retryAfterMs(retryHeader, input.now()), input.now());
  }
  if (status === 401) await input.onSessionRejected?.();
  return { posted: true, status };
}

function retryAfterMs(header: string | null, nowMs: number): number {
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
    const at = Date.parse(header);
    if (Number.isFinite(at)) return Math.max(0, at - nowMs);
  }
  return backoffDelayMs(0, () => 0);
}
