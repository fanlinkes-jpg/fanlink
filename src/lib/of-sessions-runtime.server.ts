import path from "node:path";
import { assertOwnerForce, canOperateCreator, WorkspaceAccessError } from "@/lib/access-policy";
import { DEV_USER_ID, authConfigured } from "@/lib/auth/verify.server";
import { getSql } from "@/lib/db";
import { ensureStaff } from "@/lib/workspace-store";
import { beginCreatorLogin } from "../../server/of-sessions/connect.ts";
import { messages, publicSyncReason } from "../../server/of-sessions/messages.ts";
import { parseCreatorId } from "../../server/of-sessions/types.ts";
import { assertNoCredentials } from "../../server/of-sessions/credentials.ts";
import { loadCrmSessionConfig } from "../../server/of-sessions/config.ts";
import { onlyFansSite } from "../../server/of-sessions/sessions/onlyfans.ts";
import { createPlaywrightFactory } from "../../server/of-sessions/sessions/browser-factory.ts";
import type { SessionManager } from "../../server/of-sessions/sessions/session-manager.ts";
import { createSessionRuntime } from "../../server/of-sessions/runtime.ts";
import { AccountStore } from "../../server/of-sessions/store/account-store.ts";
import { DbAccountStore } from "../../server/of-sessions/store/db-account-store.ts";
import { createMirroringStore } from "../../server/of-sessions/store/mirroring-store.ts";
import type { Account } from "../../server/of-sessions/types.ts";
import type { CreatorChatList, CreatorReadList, CreatorReadView, CreatorSessionView } from "./of-sessions.ts";
import { syncAssignments } from "../../server/of-sessions/metrics/assignments.ts";
import { chatterReports } from "../../server/of-sessions/metrics/team.ts";
import { deliverFanAlerts } from "../../server/of-sessions/notify/deliver.ts";
import { chatIntervalMinFromEnv } from "../../server/of-sessions/sync/chats.ts";
import { listChatMeta, listChats, saveChatRead } from "../../server/of-sessions/sync/chat-store.ts";
import { intervalMinFromEnv, startSyncLoop, type ScheduleAccount } from "../../server/of-sessions/sync/schedule.ts";
import {
  listCreatorReads,
  listSyncMeta,
  readChatIntervalMin,
  readSyncIntervalMin,
  saveCreatorRead,
  writeChatIntervalMin,
  writeSyncIntervalMin,
} from "../../server/of-sessions/sync/store.ts";

const globalRef = globalThis as typeof globalThis & {
  __ofSessionManager__?: Promise<SessionManager>;
  __ofSyncLoop__?: { stop: () => void };
  __ofChatLoop__?: { stop: () => void };
};

export function ensureSyncScheduler(): void {
  if (process.env.FANLINK_SYNC_ENABLED === "false") return;
  if (process.execArgv.includes("--test")) return;
  void getOfSessionManager();
}

/**
 * Gestor de sesiones de OnlyFans del proceso. No abre Chromium al arrancar:
 * la ventana sale solo de Conectar o Reconectar. El alta interrumpida se
 * marca como cerrada para no dejar el indicador en "entrando".
 */
export function getOfSessionManager(): Promise<SessionManager> {
  globalRef.__ofSessionManager__ ??= createManager().catch((error: unknown) => {
    globalRef.__ofSessionManager__ = undefined;
    throw error;
  });
  return globalRef.__ofSessionManager__;
}

async function createManager(): Promise<SessionManager> {
  const config = loadCrmSessionConfig();
  const sql = await getSql();
  const file = new AccountStore(path.join(config.dataDir, "accounts.json"));
  const db = new DbAccountStore(sql);
  const runtime = await createSessionRuntime({
    config,
    site: onlyFansSite,
    store: createMirroringStore(file, db),
    browserFactory: createPlaywrightFactory(),
  });
  await runtime.sessions.recoverInterruptedLogins();
  bootSyncLoop(runtime.sessions);
  bootChatLoop(runtime.sessions);
  return runtime.sessions;
}

function bootSyncLoop(sessions: SessionManager): void {
  if (process.env.FANLINK_SYNC_ENABLED === "false") return;
  if (process.execArgv.includes("--test")) return;
  if (globalRef.__ofSyncLoop__) return;
  globalRef.__ofSyncLoop__ = startSyncLoop({
    intervalMin: async () => readSyncIntervalMin(await getSql(), intervalMinFromEnv(process.env.FANLINK_SYNC_INTERVAL_MIN)),
    inProgressIds: () => new Set(sessions.readingIds()),
    accounts: () => scheduleAccounts(sessions),
    sync: async (accountId) => {
      const account = (await sessions.listAccounts()).find((item) => item.id === accountId);
      const creatorId = account?.creatorId ?? accountId;
      const prior = account?.creatorId ? await listCreatorReads(await getSql(), [account.creatorId]) : [];
      const read = await sessions.readCreatorData(accountId, true, prior[0]?.txCursor ?? null);
      logCreatorRead(creatorId, read);
      if (read.alreadyRunning) return;
      if (read.loginRequired) await sessions.markLoginRequired(accountId);
      if (!account?.creatorId) return;
      const sql = await getSql();
      await saveCreatorRead(sql, account.creatorId, read);
      await syncAssignments(sql, account.creatorId);
    },
  });
}

function bootChatLoop(sessions: SessionManager): void {
  if (process.env.FANLINK_SYNC_ENABLED === "false") return;
  if (process.execArgv.includes("--test")) return;
  if (globalRef.__ofChatLoop__) return;
  globalRef.__ofChatLoop__ = startSyncLoop({
    intervalMin: async () => readChatIntervalMin(await getSql(), chatIntervalMinFromEnv(process.env.FANLINK_CHAT_SYNC_MIN)),
    inProgressIds: () => new Set(sessions.readingIds()),
    accounts: () => chatScheduleAccounts(sessions),
    marginMinMs: 8_000,
    marginMaxMs: 25_000,
    sync: async (accountId) => {
      const read = await sessions.readCreatorChats(accountId);
      if (read.alreadyRunning) return;
      if (read.loginRequired) await sessions.markLoginRequired(accountId);
      const account = (await sessions.listAccounts()).find((item) => item.id === accountId);
      if (!account?.creatorId) return;
      const sql = await getSql();
      const events = await saveChatRead(sql, account.creatorId, read);
      await deliverFanAlerts(sql, events);
    },
  });
}

async function chatScheduleAccounts(sessions: SessionManager): Promise<ScheduleAccount[]> {
  const [accounts, meta] = await Promise.all([sessions.listAccounts(), listChatMeta(await getSql())]);
  const byCreator = new Map(meta.map((row) => [row.creatorId, row]));
  return accounts.flatMap((account) => {
    if (!account.creatorId) return [];
    const state = byCreator.get(account.creatorId);
    return [
      {
        accountId: account.id,
        creatorId: account.creatorId,
        status: account.status,
        identityState: account.identityState,
        hasStorageState: account.hasStorageState,
        consecutiveFailures: state?.consecutiveFailures ?? 0,
        lastAttemptAt: state?.lastAttemptAt ?? null,
      },
    ];
  });
}

async function scheduleAccounts(sessions: SessionManager): Promise<ScheduleAccount[]> {
  const [accounts, meta] = await Promise.all([sessions.listAccounts(), listSyncMeta(await getSql())]);
  const byCreator = new Map(meta.map((row) => [row.creatorId, row]));
  return accounts.flatMap((account) => {
    if (!account.creatorId) return [];
    const state = byCreator.get(account.creatorId);
    return [
      {
        accountId: account.id,
        creatorId: account.creatorId,
        status: account.status,
        identityState: account.identityState,
        hasStorageState: account.hasStorageState,
        consecutiveFailures: state?.consecutiveFailures ?? 0,
        lastAttemptAt: state?.lastAttemptAt ?? null,
      },
    ];
  });
}

async function creatorHandle(creatorId: string): Promise<string> {
  const sql = await getSql();
  const rows = await sql<{ state: { creators?: Array<{ id: string; handle?: string }> } | string }>`
    select state from workspace_state where id = 1
  `;
  const raw = rows[0]?.state;
  if (!raw) return "";
  const state = typeof raw === "string" ? (JSON.parse(raw) as { creators?: Array<{ id: string; handle?: string }> }) : raw;
  const creator = state.creators?.find((item) => item.id === creatorId);
  return typeof creator?.handle === "string" ? creator.handle : "";
}

async function accessFor(userId: string) {
  const sql = await getSql();
  return ensureStaff(sql, userId, !authConfigured && userId === DEV_USER_ID);
}

function assertCreatorOperator(userIdAccess: Awaited<ReturnType<typeof accessFor>>, creatorId: string): void {
  if (!canOperateCreator(userIdAccess, creatorId, "equipo")) {
    throw new WorkspaceAccessError("No tienes acceso para operar la sesión de esa creadora.");
  }
}

export async function listCreatorSessionViews(userId: string): Promise<CreatorSessionView[]> {
  const access = await accessFor(userId);
  const sessions = await getOfSessionManager();
  const accounts = await sessions.listAccounts();
  return accounts.flatMap((account) => {
    const view = toView(account);
    if (!view) return [];
    if (access.role !== "owner" && !access.creatorIds.includes(view.creatorId)) return [];
    return [view];
  });
}

export async function connectCreator(userId: string, input: unknown): Promise<CreatorSessionView> {
  assertNoCredentials(input);
  const creatorId = parseCreatorId(
    input && typeof input === "object" && "creatorId" in input ? (input as { creatorId: unknown }).creatorId : undefined,
  );
  assertCreatorOperator(await accessFor(userId), creatorId);
  const sessions = await getOfSessionManager();
  const account = await beginCreatorLogin(sessions, input);
  const view = toView(account);
  if (!view) throw new Error("La sesión no está ligada a una creadora");
  return view;
}

export async function inspectCreatorSession(userId: string, creatorId: string): Promise<CreatorSessionView> {
  assertCreatorOperator(await accessFor(userId), parseCreatorId(creatorId));
  const sessions = await getOfSessionManager();
  const accounts = await sessions.listAccounts();
  const account = accounts.find((item) => item.creatorId === creatorId);
  if (!account) throw new Error("No hay sesión guardada para comprobar.");
  const view = toView(await sessions.inspectConnection(account.id, await creatorHandle(creatorId)));
  if (!view) throw new Error("La sesión no está ligada a una creadora");
  return view;
}

export async function listCreatorReadViews(userId: string): Promise<CreatorReadList> {
  const access = await accessFor(userId);
  const sessions = await getOfSessionManager();
  const accounts = await sessions.listAccounts();
  const creatorIds = accounts.flatMap((account) => {
    if (!account.creatorId) return [];
    if (access.role !== "owner" && !access.creatorIds.includes(account.creatorId)) return [];
    return [account.creatorId];
  });
  const sql = await getSql();
  const rows = await listCreatorReads(sql, creatorIds);
  const running = new Set((await getOfSessionManager()).readingIds());
  return {
    role: access.role,
    intervalMin: await readSyncIntervalMin(sql, intervalMinFromEnv(process.env.FANLINK_SYNC_INTERVAL_MIN)),
    chatIntervalMin: await readChatIntervalMin(sql, chatIntervalMinFromEnv(process.env.FANLINK_CHAT_SYNC_MIN)),
    runningCreatorIds: visibleRunning(accounts, access.role === "owner" ? null : new Set(access.creatorIds), running),
    creators: rows.map((row) => presentRead(access.role, row)),
  };
}

export async function setSyncIntervalView(
  userId: string,
  minutes: number,
  chatMinutes?: number,
): Promise<{ intervalMin: number; chatIntervalMin: number }> {
  const access = await accessFor(userId);
  if (access.role !== "owner") {
    throw new WorkspaceAccessError("Solo la dueña cambia cada cuánto se sincroniza.");
  }
  const sql = await getSql();
  const intervalMin = await writeSyncIntervalMin(sql, minutes);
  const chatIntervalMin =
    chatMinutes == null
      ? await readChatIntervalMin(sql, chatIntervalMinFromEnv(process.env.FANLINK_CHAT_SYNC_MIN))
      : await writeChatIntervalMin(sql, chatMinutes);
  return { intervalMin, chatIntervalMin };
}

export async function listCreatorChatViews(userId: string): Promise<CreatorChatList> {
  const access = await accessFor(userId);
  const sessions = await getOfSessionManager();
  const accounts = await sessions.listAccounts();
  const creatorIds = accounts.flatMap((account) => {
    if (!account.creatorId) return [];
    if (access.role !== "owner" && !access.creatorIds.includes(account.creatorId)) return [];
    return [account.creatorId];
  });
  const sql = await getSql();
  const stored = await listChats(sql, creatorIds);
  const running = new Set(sessions.readingIds());
  return {
    runningCreatorIds: visibleRunning(accounts, access.role === "owner" ? null : new Set(access.creatorIds), running),
    threads: stored.threads.map((thread) => ({
      creatorId: thread.creatorId,
      threadKey: thread.threadKey,
      fanKey: thread.fanKey,
      fanHandle: thread.fanHandle,
      fanName: thread.fanName,
      lastMessageAt: thread.lastMessageAt,
      excerpt: thread.excerpt,
      unread: thread.unread,
    })),
    messages: stored.messages.map((message) => ({
      creatorId: message.creatorId,
      threadKey: message.threadKey,
      messageKey: message.messageKey,
      fanKey: message.fanKey,
      fromFan: message.fromFan,
      body: message.body,
      sentAt: message.sentAt,
      priceCents: message.priceCents,
      purchased: message.purchased,
    })),
    meta: stored.meta.map((item) => ({
      creatorId: item.creatorId,
      syncedAt: item.syncedAt,
      status: item.status,
      reason: publicSyncReason(item.reason),
    })),
  };
}

export async function syncCreatorChatView(userId: string, creatorId: string): Promise<void> {
  const access = await accessFor(userId);
  assertOwnerForce(access);
  const id = parseCreatorId(creatorId);
  const sessions = await getOfSessionManager();
  const account = (await sessions.listAccounts()).find((item) => item.creatorId === id);
  if (!account) throw new Error("No hay sesión guardada para sincronizar.");
  const read = await sessions.readCreatorChats(account.id);
  if (read.loginRequired) await sessions.markLoginRequired(account.id);
  if (!read.alreadyRunning) {
    const sql = await getSql();
    const events = await saveChatRead(sql, id, read);
    await deliverFanAlerts(sql, events);
  }
}

export async function syncCreatorReadView(userId: string, creatorId: string): Promise<CreatorReadView> {
  const access = await accessFor(userId);
  assertOwnerForce(access);
  const id = parseCreatorId(creatorId);
  const sessions = await getOfSessionManager();
  const account = (await sessions.listAccounts()).find((item) => item.creatorId === id);
  if (!account) throw new Error("No hay sesión guardada para sincronizar.");
  const sql = await getSql();
  const prior = await listCreatorReads(sql, [id]);
  const read = await sessions.readCreatorData(account.id, true, prior[0]?.txCursor ?? null);
  logCreatorRead(id, read);
  if (read.loginRequired) await sessions.markLoginRequired(account.id);
  if (!read.alreadyRunning) {
    await saveCreatorRead(sql, id, read);
    await syncAssignments(sql, id);
  }
  const [stored] = await listCreatorReads(sql, [id]);
  if (!stored) {
    return {
      creatorId: id,
      earningsSyncedAt: null,
      fansSyncedAt: null,
      lastReason: publicSyncReason(read.reason),
      lastAttemptAt: null,
      consecutiveFailures: 0,
      lastStatus: read.alreadyRunning ? "idle" : "error",
      earnings: access.role === "owner" ? [] : null,
      fans: [],
      transactions: access.role === "owner" ? [] : null,
    };
  }
  return presentRead(access.role, stored);
}

function presentRead(role: "owner" | "member", row: Awaited<ReturnType<typeof listCreatorReads>>[number]): CreatorReadView {
  const owner = role === "owner";
  return {
    creatorId: row.creatorId,
    earningsSyncedAt: owner ? row.earningsSyncedAt : null,
    fansSyncedAt: row.fansSyncedAt,
    lastReason: publicSyncReason(row.lastReason),
    lastAttemptAt: row.lastAttemptAt,
    consecutiveFailures: row.consecutiveFailures,
    lastStatus: row.lastStatus,
    earnings: owner
      ? row.earnings.map((item) => ({
          day: item.day,
          kind: item.kind,
          amountCents: item.amountCents,
          currency: item.currency,
        }))
      : null,
    fans: row.fans.map((item) => ({
      fanKey: item.fanKey,
      ofUserId: item.ofUserId,
      handle: item.handle,
      displayName: item.displayName,
      subscribedAt: item.subscribedAt,
      status: item.status,
      spentCents: owner ? item.spentCents : null,
      renewAuto: item.renewAuto,
      expiresAt: item.expiresAt,
    })),
    transactions: owner
      ? row.transactions.map((item) => ({
          txKey: item.txKey,
          occurredAt: item.occurredAt,
          grossCents: item.grossCents,
          netCents: item.netCents,
          kind: item.kind,
          fanKey: item.fanKey,
          currency: item.currency,
        }))
      : null,
  };
}

function visibleRunning(
  accounts: Array<{ id: string; creatorId: string | null }>,
  allowed: Set<string> | null,
  running: Set<string>,
): string[] {
  return accounts.flatMap((account) => {
    if (!account.creatorId || !running.has(account.id)) return [];
    if (allowed && !allowed.has(account.creatorId)) return [];
    return [account.creatorId];
  });
}

export async function listTeamMetricViews(userId: string): Promise<Array<{
  userId: string;
  name: string;
  grossCents: number | null;
  ppvSent: number | null;
  ppvBought: number | null;
  firstReplyMinutes: number | null;
  threads: number | null;
}>> {
  const access = await accessFor(userId);
  const sql = await getSql();
  const assignments = await sql.query<{ creator_id: string; user_id: string; started_at: Date | string; ended_at: Date | string | null }>(
    "select creator_id, user_id, started_at, ended_at from of_assignment",
  );
  const allowed = new Set(access.role === "owner" ? assignments.map((row) => row.creator_id) : access.creatorIds);
  const spans = assignments
    .filter((row) => allowed.has(row.creator_id) && (access.role === "owner" || row.user_id === access.userId))
    .map((row) => ({
      creatorId: row.creator_id,
      userId: row.user_id,
      startedAt: row.started_at instanceof Date ? row.started_at.toISOString() : String(row.started_at),
      endedAt: row.ended_at == null ? null : row.ended_at instanceof Date ? row.ended_at.toISOString() : String(row.ended_at),
    }));
  const sales = await sql.query<{ creator_id: string; occurred_at: Date | string; gross_cents: number | string }>(
    "select creator_id, occurred_at, gross_cents from of_transaction where kind = 'tip'",
  );
  const messages = await sql.query<{
    creator_id: string;
    thread_key: string;
    sent_at: Date | string;
    from_fan: boolean | string;
    price_cents: number | string | null;
    purchased: boolean | string | null;
  }>("select creator_id, thread_key, sent_at, from_fan, price_cents, purchased from of_chat_message");
  const names = await sql.query<{ user_id: string; display_name: string }>("select user_id, display_name from staff_profile");
  const nameOf = new Map(names.map((row) => [row.user_id, row.display_name]));
  const asIso = (value: Date | string) => (value instanceof Date ? value.toISOString() : String(value));
  const chatRows = messages
    .filter((row) => allowed.has(row.creator_id))
    .map((row) => ({
      creatorId: row.creator_id,
      threadKey: row.thread_key,
      at: asIso(row.sent_at),
      fromFan: row.from_fan === true || row.from_fan === "t" || row.from_fan === "true",
      priceCents: row.price_cents == null ? null : Number(row.price_cents),
      purchased: row.purchased == null ? null : row.purchased === true || row.purchased === "t" || row.purchased === "true",
    }));
  const ppvSales = chatRows
    .filter((row) => !row.fromFan && row.purchased === true && row.priceCents != null)
    .map((row) => ({ creatorId: row.creatorId, at: row.at, grossCents: row.priceCents ?? 0, kind: "ppv" as const }));
  return chatterReports({
    assignments: spans,
    sales: [
      ...sales
        .filter((row) => allowed.has(row.creator_id))
        .map((row) => ({ creatorId: row.creator_id, at: asIso(row.occurred_at), grossCents: Number(row.gross_cents), kind: "tip" as const })),
      ...ppvSales,
    ],
    messages: chatRows,
  }).map((row) => ({
    userId: row.userId,
    name: nameOf.get(row.userId) ?? row.userId,
    grossCents: access.role === "owner" || row.userId === access.userId ? row.grossCents : null,
    ppvSent: row.ppvSent,
    ppvBought: row.ppvBought,
    firstReplyMinutes: row.firstReplyMinutes,
    threads: row.threads,
  }));
}

function logCreatorRead(
  creatorId: string,
  read: { reason: string | null; fans: unknown[]; earnings: unknown[]; alreadyRunning?: boolean },
): void {
  if (read.alreadyRunning) {
    console.info(`[fanlink:lectura] cuenta=${creatorId} resultado=en curso`);
    return;
  }
  const motivo = read.reason ? ` motivo=${publicSyncReason(read.reason) ?? messages.loginRequired}` : "";
  console.info(
    `[fanlink:lectura] cuenta=${creatorId} resultado=${read.reason ? "error" : "ok"} fans=${read.fans.length} ingresos=${read.earnings.length}${motivo}`,
  );
}

function toView(account: Account): CreatorSessionView | null {
  if (!account.creatorId) return null;
  return {
    creatorId: account.creatorId,
    accountId: account.id,
    label: account.label,
    status: account.status,
    loginInProgress: account.loginInProgress,
    sessionRejected: account.sessionRejected,
    hasStorageState: account.hasStorageState,
    connection: account.connection,
    identityState: account.identityState,
    identityLabel: account.identityLabel,
    identityHandle: account.identityHandle,
    identityName: account.identityName,
    identityUserId: account.identityUserId,
    identityCheckedAt: account.identityCheckedAt,
    identityReason: publicSyncReason(account.identityReason),
    readsBlocked: account.identityState === "mismatch",
    lastCheckedAt: account.lastCheckedAt,
    lastError: publicSyncReason(account.lastError),
  };
}
