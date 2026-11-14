import { WorkspaceAccessError } from "../../../src/lib/access-policy.ts";
import { ONLINE_FAN_CAP } from "../../../src/lib/online-fan-row.ts";
import { noteStaleOnlineSends } from "../send/online-claim.ts";
import { type SendAccount } from "../send/gate.ts";
import { canSeeOnlineFans, onlineBroadcastGate, visibleOnlineCreatorIds } from "../send/online-broadcast.ts";
import type { SessionManager } from "../sessions/session-manager.ts";
import { accountPause, noteAccountBlock } from "./backoff.ts";
import { withAccountApi } from "./api-list-pace.ts";
import { markOpenedChat, markOpenRejected, markReadGate } from "./mark-read.ts";
import { sessionForApi } from "./of-chat-api.ts";
import { loadSignRules } from "./of-sign.ts";
import { mergeOnlineAccounts, type OnlineFan } from "./online-fans.ts";
import { SESSION_EXPIRED_LABEL, signedReadsBlocked } from "./session-link.ts";
import type { ReadSql } from "./store.ts";
import { parseCreatorId, type Account } from "../types.ts";
import { blockedVisibleSpend, canReadFanSpend, runVisibleFanSpend, spendReadsBlocked } from "./visible-spend.ts";

type StaffAccess = {
  userId: string;
  role: "owner" | "member";
  perms: readonly string[];
  creatorIds: readonly string[];
};

type SignedViewDeps = {
  accessFor: (userId: string) => Promise<StaffAccess>;
  sessions: () => Promise<SessionManager>;
  sql: () => Promise<ReadSql>;
};

let deps: SignedViewDeps | null = null;

/** La app enchufa acceso, gestor y SQL. El test enchufa los suyos. */
export function bindSignedViews(next: SignedViewDeps): void {
  deps = next;
}

function bound(): SignedViewDeps {
  if (!deps) throw new Error("Las vistas firmadas no están enchufadas.");
  return deps;
}

function sendAccount(account: Account): SendAccount {
  return {
    creatorId: account.creatorId,
    accountId: account.id,
    handle: account.identityHandle,
    userId: account.identityUserId,
    label: account.label,
  };
}

export async function listOnlineFansView(userId: string, input: { creatorId: string }): Promise<{ fans: OnlineFan[]; reason: string | null; notices: string[]; cap: number; send: { enabled: boolean; reason: string | null } }> {
  const kit = bound();
  const access = await kit.accessFor(userId);
  if (input.creatorId !== "all" && !canSeeOnlineFans(access, input.creatorId)) {
    throw new WorkspaceAccessError("No tienes acceso para operar la sesión de esa creadora.");
  }
  if (input.creatorId === "all" && access.role !== "owner" && !access.perms.includes("mensajes")) {
    return { fans: [], reason: "Sin datos", notices: [], cap: ONLINE_FAN_CAP, send: { enabled: false, reason: "Sin datos" } };
  }
  const sessions = await kit.sessions();
  const accounts = await sessions.listAccounts();
  const known = accounts.flatMap((account) => account.creatorId ? [account.creatorId] : []);
  const wanted = visibleOnlineCreatorIds(access, input.creatorId, known);
  if (wanted.length === 0) return { fans: [], reason: "Sin datos", notices: [], cap: ONLINE_FAN_CAP, send: { enabled: false, reason: "Sin datos" } };
  await noteStaleOnlineSends(await kit.sql(), Date.now());
  if (input.creatorId === "all") {
    const reads = [];
    for (const creatorId of wanted) {
      const account = accounts.find((item) => item.creatorId === creatorId);
      if (!account || signedReadsBlocked(account)) {
        reads.push({ creatorId, fans: [], reason: SESSION_EXPIRED_LABEL, status: 401 });
        continue;
      }
      const read = await sessions.readOnlineFans(account.id);
      console.info(`[fanlink:online] cuenta=${creatorId} fans=${read.fans.length} motivo=${read.reason ?? "ok"} status=${read.status ?? "sin"}`);
      reads.push({ creatorId, fans: read.fans, reason: read.reason, status: read.status });
    }
    const merged = mergeOnlineAccounts(reads);
    const reason = merged.fans.length === 0
      ? merged.notices[0] ?? reads.find((read) => read.reason)?.reason ?? "Nadie en línea"
      : null;
    return { fans: merged.fans, reason, notices: merged.notices, cap: ONLINE_FAN_CAP, send: { enabled: false, reason: "Elige una cuenta" } };
  }
  const account = accounts.find((item) => item.creatorId === input.creatorId);
  if (!account) return { fans: [], reason: "Sin datos", notices: [], cap: ONLINE_FAN_CAP, send: { enabled: false, reason: "Sin datos" } };
  const gate = onlineBroadcastGate(process.env, {
    creatorId: account.creatorId,
    accountId: account.id,
    handle: account.identityHandle,
    userId: account.identityUserId,
    label: account.label,
  });
  const send = { enabled: gate.allowed, reason: gate.allowed ? null : gate.reason };
  if (signedReadsBlocked(account)) {
    return { fans: [], reason: SESSION_EXPIRED_LABEL, notices: [`${input.creatorId}: ${SESSION_EXPIRED_LABEL}`], cap: ONLINE_FAN_CAP, send };
  }
  const read = await sessions.readOnlineFans(account.id);
  console.info(`[fanlink:online] cuenta=${input.creatorId} fans=${read.fans.length} motivo=${read.reason ?? "ok"} status=${read.status ?? "sin"}`);
  const notices = read.status === 401 || read.reason === SESSION_EXPIRED_LABEL
    ? [`${input.creatorId}: ${SESSION_EXPIRED_LABEL}`]
    : [];
  return { fans: read.fans, reason: read.reason, notices, cap: ONLINE_FAN_CAP, send };
}

export async function readVisibleFanSpendView(userId: string, input: { creatorId: string; fanIds: string[]; cardIds?: string[] }): Promise<{ byFan: Record<string, number | null>; retryAfterMs: number; blocked: boolean }> {
  const kit = bound();
  const access = await kit.accessFor(userId);
  if (!canReadFanSpend(access.role, access.perms)) {
    throw new WorkspaceAccessError("No tienes permiso para leer los chats.");
  }
  const creatorId = parseCreatorId(input.creatorId);
  const fanIds = [...new Set(input.fanIds.filter((id) => /^\d{1,20}$/.test(id)))].slice(0, 10);
  const sessions = await kit.sessions();
  const account = (await sessions.listAccounts()).find((item) => item.creatorId === creatorId);
  if (!account || fanIds.length === 0) return { byFan: {}, retryAfterMs: 0, blocked: false };
  const epoch = sessions.sessionGeneration(account.id);
  const blocked = blockedVisibleSpend(
    accountPause(account.id)?.until ?? null,
    spendReadsBlocked(account) || signedReadsBlocked(account),
    Date.now(),
  );
  if (blocked) return blocked;
  let state;
  try {
    state = await sessions.readStorageState(account.id);
  } catch {
    return { byFan: {}, retryAfterMs: 0, blocked: false };
  }
  const auth = sessionForApi(state, Date.now());
  if ("reason" in auth) return { byFan: {}, retryAfterMs: 0, blocked: false };
  const rules = await loadSignRules(fetch, Date.now());
  return withAccountApi(account.id, async () => runVisibleFanSpend({
    accountId: account.id,
    creatorId,
    fanIds,
    cardIds: input.cardIds,
    auth,
    rules,
    fetch,
    now: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    sql: await kit.sql(),
    log: (line) => console.info(line),
    onSessionRejected: () => sessions.noteApiSessionRejected(account.id, epoch),
    onBlock: (reason) => noteAccountBlock(account.id, reason),
  }));
}

export async function markChatOpenedView(userId: string, input: { creatorId: string; threadKey: string }): Promise<{ marked: boolean }> {
  const kit = bound();
  const access = await kit.accessFor(userId);
  if (access.role !== "owner" && !access.perms.includes("mensajes")) {
    throw new WorkspaceAccessError("No tienes permiso para escribir.");
  }
  const creatorId = parseCreatorId(input.creatorId);
  const sessions = await kit.sessions();
  const account = (await sessions.listAccounts()).find((item) => item.creatorId === creatorId);
  if (!account) return { marked: false };
  if (markOpenRejected(account.identityState, accountPause(account.id) != null)) return { marked: false };
  const fields = sendAccount(account);
  if (!markReadGate(process.env.FANLINK_CHAT_MARK_READ, process.env.FANLINK_SEND_ALLOW_ACCOUNTS, fields).allowed) {
    return { marked: false };
  }
  const epoch = sessions.sessionGeneration(account.id);
  let state;
  try {
    state = await sessions.readStorageState(account.id);
  } catch {
    return { marked: false };
  }
  const auth = sessionForApi(state, Date.now());
  if ("reason" in auth) return { marked: false };
  const rules = await loadSignRules(fetch, Date.now());
  const result = await markOpenedChat({
    accountId: account.id,
    creatorId,
    threadKey: input.threadKey,
    flag: process.env.FANLINK_CHAT_MARK_READ,
    allowlist: process.env.FANLINK_SEND_ALLOW_ACCOUNTS,
    account: fields,
    sql: await kit.sql(),
    fetch,
    now: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    rules,
    auth,
    log: (line) => console.info(line),
    onSessionRejected: () => sessions.noteApiSessionRejected(account.id, epoch),
  });
  return { marked: result.status != null && result.status >= 200 && result.status < 300 };
}
