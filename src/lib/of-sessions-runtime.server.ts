import path from "node:path";
import { assertOwnerForce, canOperateCreator, creatorIdsForChats, WorkspaceAccessError } from "@/lib/access-policy";
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
import type { CollectedChats } from "../../server/of-sessions/sync/collect-chats.ts";
import type { CreatorChatList, CreatorReadList, CreatorReadView, CreatorSessionView } from "./of-sessions.ts";
import { parseAccountProxy, proxyLabel, readAccountProxy, removeAccountProxy, writeAccountProxy } from "../../server/of-sessions/proxy.ts";
import { syncAssignments } from "../../server/of-sessions/metrics/assignments.ts";
import { dashboardViewFor } from "../../server/of-sessions/metrics/dashboard.ts";
import { apiListStep, passApiListAccounts, shouldReadApiList } from "../../server/of-sessions/sync/api-list-cycle.ts";
import { passNotificationAccounts } from "../../server/of-sessions/sync/notification-cycle.ts";
import type { NotificationPace } from "../../server/of-sessions/sync/api-list-pace.ts";
import { accountSessionNotices, deriveConnectedFromLastRead, SESSION_EXPIRED_LABEL, signedReadsBlocked } from "../../server/of-sessions/sync/session-link.ts";
import { mergeOnlineAccounts } from "../../server/of-sessions/sync/online-fans.ts";
import { accountPause, blockKind, listAccountPauses, noteAccountBlock } from "../../server/of-sessions/sync/backoff.ts";
import { presentTeamMetrics } from "../../server/of-sessions/metrics/present-team.ts";
import { creatorIdsForReads } from "@/lib/dashboard-config";
import { assertChatFanCardThreadLimit, chatFanCardsFrom, type ChatFanCard } from "@/lib/chat-fan-cards";
import { deliverFanAlerts } from "../../server/of-sessions/notify/deliver.ts";
import { chatIntervalMinFromEnv } from "../../server/of-sessions/sync/chats.ts";
import { chatIntervalMinutes, inboxIsOpen, activeThreadWatches } from "../../server/of-sessions/sync/live.ts";
import { openWatchContext, runInboxWatch } from "../../server/of-sessions/sync/inbox-watch.ts";
import { pickAccountWatch } from "../../server/of-sessions/sync/watch-plan.ts";
import { listChatMeta, listChats, listOpenHistory, listPendingOutbounds, markChatList, markHistory, markOutboundAwaiting, recordOutbound, saveChatRead, saveFanCards } from "../../server/of-sessions/sync/chat-store.ts";
import { historyPerMinute, listPageDone, nextHistoryThread, oldestCursor, pageFinished } from "../../server/of-sessions/sync/history.ts";
import { captureChatListPage, captureOlderMessages } from "../../server/of-sessions/sync/history-scroll.ts";
import { openWorkPage } from "../../server/of-sessions/sessions/work-page.ts";
import { type VaultFile } from "../../server/of-sessions/sync/vault-listen.ts";
import { readChatVaultView as readVaultPage, type VaultReadDeps } from "../../server/of-sessions/sync/vault-read.ts";
import { ONLINE_FAN_CAP } from "@/lib/online-fan-row";
import { fetchSignedOnlineFans, type OnlineFan } from "../../server/of-sessions/sync/online-fans.ts";
import { sessionForApi } from "../../server/of-sessions/sync/of-chat-api.ts";
import { loadSignRules } from "../../server/of-sessions/sync/of-sign.ts";
import { prepareVaultSend } from "../../server/of-sessions/sync/vault-store.ts";
import { withAccountApi } from "../../server/of-sessions/sync/api-list-pace.ts";
import { canSeeOnlineFans, cancelOnlineBroadcast, emptyOnlineBroadcast, onlineBroadcastGate, refuseOnlineBroadcast, sendOnlineBroadcast, visibleOnlineCreatorIds, type OnlineBroadcastResult } from "../../server/of-sessions/send/online-broadcast.ts";
import { claimOnlineOutbound, finishOnlineOutbound, noteStaleOnlineSends, resolveStaleOnlineSend } from "../../server/of-sessions/send/online-claim.ts";
import { normalizeFanMenuRequest, runFanMenuOnPage, type FanMenuResult } from "../../server/of-sessions/sync/fan-menu.ts";
import { chatPageUrl } from "../../server/of-sessions/sync/chats.ts";
import { sendPace } from "../../server/of-sessions/send/gate.ts";
import { chatSendGate, publicSendReason, type SendAccount } from "../../server/of-sessions/send/gate.ts";
import { markOpenedChat, markOpenRejected, markReadGate } from "../../server/of-sessions/sync/mark-read.ts";
import type { SendChatHooks } from "../../server/of-sessions/send/chat-message.ts";
import { composeChat } from "../../server/of-sessions/send/compose.ts";
import { liveViewGate } from "../../server/of-sessions/live/desk.ts";
import { issueLiveTicket } from "../../server/of-sessions/live/tickets.ts";
import { listFanProfiles, saveFanProfile } from "../../server/of-sessions/sync/fan-profile.ts";
import { listFanNotes, saveFanNote } from "../../server/of-sessions/sync/fan-note.ts";
import { intervalMinFromEnv, startSyncLoop, type ScheduleAccount } from "../../server/of-sessions/sync/schedule.ts";
import { saveNotificationRead } from "../../server/of-sessions/sync/notification-store.ts";
import {
  listCreatorReads,
  listSyncMeta,
  readChatIntervalMin,
  readSyncIntervalMin,
  saveCreatorRead,
  writeChatIntervalMin,
  writeSyncIntervalMin,
} from "../../server/of-sessions/sync/store.ts";

export { sendChatMessageView } from "../../server/of-sessions/send/chat-message.ts";

const globalRef = globalThis as typeof globalThis & {
  __ofSessionManager__?: Promise<SessionManager>;
  __ofSyncLoop__?: { stop: () => void };
  __ofChatLoop__?: { stop: () => void };
  __ofNotificationLoop__?: boolean;
  __ofApiList__?: boolean;
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
  bootApiListLoop(runtime.sessions);
  bootHistoryLoop(runtime.sessions);
  bootNotificationLoop(runtime.sessions);
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
      const read = await sessions.readCreatorData(accountId, true, txCursorOf(prior[0]));
      logCreatorRead(creatorId, read);
      if (read.alreadyRunning) return;
      if (read.loginRequired) await sessions.markLoginRequired(accountId);
      const blocked = blockKind(0, read.reason ?? "");
      if (blocked) noteAccountBlock(accountId, blocked);
      if (!account?.creatorId) return;
      const sql = await getSql();
      await saveCreatorRead(sql, account.creatorId, read);
      await syncAssignments(sql, account.creatorId);
    },
  });
}

const threadRef = { key: "chat" };
const userRef = { id: null as string | null };
let watchLoop: Promise<void> | null = null;

export function kickInboxWatch(): void {
  if (watchLoop || process.execArgv.includes("--test")) return;
  watchLoop = runInboxWatch({
    stopped: () => false,
    target: () => {
      const picked = pickAccountWatch(activeThreadWatches());
      if (!picked) return null;
      const accountId = accountForCreator(picked.creatorId);
      if (!accountId) return null;
      userRef.id = creatorUsers.get(picked.creatorId) ?? null;
      return {
        accountId,
        creatorId: picked.creatorId,
        threads: picked.threads,
        watchers: picked.watchers,
        chatsUrl: onlyFansSite.chatsUrl ?? "https://onlyfans.com/my/chats",
        siteId: onlyFansSite.id,
      };
    },
    open: async (accountId) => {
      const sessions = await getOfSessionManager();
      return new Promise((resolve, reject) => {
        let finish: () => void = () => undefined;
        const closed = new Promise<void>((done) => {
          finish = done;
        });
        void sessions.holdWatch(accountId, async (context) => {
          const session = await openWatchContext(context, () => threadRef.key, () => userRef.id);
          resolve({
            goto: (url) => session.goto(url),
            listen: (handlers) => session.listen(handlers),
            close: async () => {
              await session.close();
              finish();
            },
          });
          await closed;
        }).then((ran) => {
          if (!ran) reject(new Error("perfil ocupado"));
        }).catch(reject);
      });
    },
    save: async (creatorId, messages) => {
      await saveChatRead(await getSql(), creatorId, { threads: [], messages, reason: null, jsonPaths: [] });
      console.info(`[fanlink:chat] mensajes creator=${creatorId} nuevos=${messages.length}`);
    },
    saveThreads: async (creatorId, threads) => {
      await saveChatRead(await getSql(), creatorId, { threads, messages: [], reason: null, jsonPaths: [] });
      console.info(`[fanlink:chat] lista creator=${creatorId} hilos=${threads.length}`);
    },
    saveUsers: async (creatorId, users) => {
      await saveFanCards(await getSql(), creatorId, users);
    },
    onNavigate: (threadKey) => {
      threadRef.key = threadKey ?? "";
    },
    onBlock: (accountId, reason) => {
      const delay = noteAccountBlock(accountId, reason);
      console.info(`[fanlink:chat] escucha pausada cuenta=${accountId} motivo=${reason} espera=${delay}`);
      return delay;
    },
    pullList: async (accountId, openThreadKeys) => {
      const sessions = await getOfSessionManager();
      const account = (await sessions.listAccounts()).find((item) => item.id === accountId);
      if (!account || !shouldReadApiList(account, false)) return false;
      const pause = accountPause(accountId);
      if (pause) return { ok: false, waitMs: Math.max(200, pause.until - Date.now()) };
      const read = await sessions.readPacedChats(accountId, "all", openThreadKeys);
      if (read.reason?.includes("espera el ritmo")) return true;
      return finishApiRead(account, read);
    },
    now: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  }).finally(() => {
    watchLoop = null;
  });
}

function accountForCreator(creatorId: string): string | null {
  const cached = creatorAccounts.get(creatorId);
  return cached ?? null;
}

const creatorAccounts = new Map<string, string>();
const notificationPace = new Map<string, NotificationPace>();
const creatorUsers = new Map<string, string | null>();

export async function rememberCreatorAccounts(): Promise<void> {
  const accounts = await (await getOfSessionManager()).listAccounts();
  creatorAccounts.clear();
  creatorUsers.clear();
  for (const account of accounts) {
    if (account.creatorId) {
      creatorAccounts.set(account.creatorId, account.id);
      creatorUsers.set(account.creatorId, account.identityUserId);
    }
  }
}

function bootHistoryLoop(sessions: SessionManager): void {
  if (process.env.FANLINK_HISTORY_ENABLED !== "true") return;
  if (process.execArgv.includes("--test")) return;
  const recent: number[] = [];
  const skipUntil = new Map<string, number>();
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  void (async () => {
    await sleep(20_000);
    while (true) {
      try {
        const accounts = await sessions.listAccounts();
        let stepped = false;
        for (const account of accounts) {
          if (!account.creatorId || account.identityState === "mismatch" || signedReadsBlocked(account)) continue;
          const open = await listOpenHistory(await getSql(), account.creatorId);
          const next = nextHistoryThread(open.filter((item) => (skipUntil.get(`${account.creatorId}:${item.threadKey}`) ?? 0) <= Date.now()));
          if (!next) continue;
          const pace = sendPace(recent, Date.now(), historyPerMinute(process.env.FANLINK_HISTORY_PER_MINUTE));
          if (pace.waitMs > 0) await sleep(Math.min(pace.waitMs, 60_000));
          const got = await pullOlder(sessions, account.id, account.creatorId, next.threadKey, account.identityUserId);
          if (got === "empty") skipUntil.set(`${account.creatorId}:${next.threadKey}`, Date.now() + 10 * 60_000);
          recent.push(Date.now());
          stepped = true;
          await sleep(2_000 + Math.floor(Math.random() * 3_000));
        }
        if (!stepped) await sleep(30_000);
      } catch (error) {
        console.info(`[fanlink:chat] historico ${error instanceof Error ? error.message.slice(0, 120) : "error"}`);
        await sleep(15_000);
      }
    }
  })();
}

async function pullOlder(sessions: SessionManager, accountId: string, creatorId: string, threadKey: string, accountUserId: string | null): Promise<"saved" | "empty" | "busy" | "done"> {
  const sql = await getSql();
  const open = await listOpenHistory(sql, creatorId);
  const row = open.find((item) => item.threadKey === threadKey);
  if (row?.done) return "done";
  const ran = await sessions.runQueued(accountId, async (context) => {
    const page = await context.newPage();
    try {
      await page.goto(chatPageUrl(onlyFansSite.chatsUrl ?? "https://onlyfans.com/my/chats", threadKey, onlyFansSite.id), { waitUntil: "domcontentloaded", timeout: 20_000 }).catch(() => undefined);
      return await captureOlderMessages(page, { threadKey, fanKey: null, accountUserId, waitMs: 4_000 });
    } finally {
      await page.close().catch(() => undefined);
    }
  });
  if (!ran.ok) return "busy";
  if (ran.value.length === 0) return "empty";
  const done = pageFinished(row?.cursor ?? null, ran.value);
  await saveChatRead(sql, creatorId, { threads: [], messages: ran.value, reason: null, jsonPaths: [] });
  await markHistory(sql, creatorId, threadKey, oldestCursor(ran.value) ?? row?.cursor ?? null, done);
  return "saved";
}

async function finishApiRead(account: Account, read: CollectedChats): Promise<boolean | { ok: false; waitMs: number }> {
  const step = apiListStep(account, {
    threadCount: read.threads.length,
    messageCount: read.messages.length,
    reason: read.reason,
    sessionRejected: read.sessionRejected === true,
    signatureRejected: read.signatureRejected === true,
    retryAfterMs: read.retryAfterMs ?? 0,
  });
  if (step.save && account.creatorId) await saveChatRead(await getSql(), account.creatorId, read);
  if (step.backoff) {
    const existing = accountPause(account.id);
    const delay = existing ? Math.max(200, existing.until - Date.now()) : noteAccountBlock(account.id, read.signatureRejected ? "400" : "429");
    console.info(`${step.line} espera=${delay}`);
    return { ok: false, waitMs: delay };
  }
  console.info(step.line);
  return step.save;
}

function bootApiListLoop(sessions: SessionManager): void {
  if (process.env.FANLINK_SYNC_ENABLED === "false") return;
  if (process.execArgv.includes("--test")) return;
  if (globalRef.__ofApiList__) return;
  globalRef.__ofApiList__ = true;
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const skipNoted = new Set<string>();
  void (async () => {
    await sleep(5_000);
    while (true) {
      try {
        const listed = await sessions.listAccounts();
        const ready = await applyDerivedConnections(sessions, listed);
        await passApiListAccounts(sessions, ready, skipNoted, async (account, read) => {
          await finishApiRead(account, read);
        });
      } catch (error) {
        const text = error instanceof Error ? error.message.slice(0, 120) : "error";
        console.info(`[fanlink:chat] api lista creator=- account=-: ${text}`);
      }
      await sleep(15_000);
    }
  })();
}

function bootChatLoop(sessions: SessionManager): void {
  if (process.env.FANLINK_SYNC_ENABLED === "false") return;
  if (process.execArgv.includes("--test")) return;
  if (globalRef.__ofChatLoop__) return;
  globalRef.__ofChatLoop__ = startSyncLoop({
    intervalMin: async () => chatIntervalMinutes(
      await readChatIntervalMin(await getSql(), chatIntervalMinFromEnv(process.env.FANLINK_CHAT_SYNC_MIN)),
      inboxIsOpen(),
    ),
    inProgressIds: () => new Set(sessions.readingIds()),
    accounts: () => chatScheduleAccounts(sessions),
    marginMinMs: 8_000,
    marginMaxMs: 25_000,
    sync: async (accountId) => {
      const read = await sessions.readCreatorChats(accountId);
      if (read.alreadyRunning) return;
      if (read.loginRequired) await sessions.markLoginRequired(accountId);
      const blockedChat = blockKind(0, read.reason ?? "");
      if (blockedChat) noteAccountBlock(accountId, blockedChat);
      const account = (await sessions.listAccounts()).find((item) => item.id === accountId);
      if (!account?.creatorId) return;
      const sql = await getSql();
      const events = await saveChatRead(sql, account.creatorId, read);
      await deliverFanAlerts(sql, events);
    },
  });
}

function bootNotificationLoop(sessions: SessionManager): void {
  if (process.env.FANLINK_SYNC_ENABLED === "false") return;
  if (process.execArgv.includes("--test")) return;
  if (globalRef.__ofNotificationLoop__) return;
  globalRef.__ofNotificationLoop__ = true;
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const skipNoted = new Set<string>();
  void (async () => {
    await sleep(5_000);
    while (true) {
      try {
        await passNotificationAccounts({
          accounts: await sessions.listAccounts(),
          noted: skipNoted,
          pace: notificationPace,
          now: () => Date.now(),
          read: (account) => sessions.readNotificationsDirect(account.id),
          finish: async (account, read) => {
            if (!account.creatorId) return;
            await saveNotificationRead(await getSql(), account.creatorId, read);
          },
          onBlock: (accountId, reason) => noteAccountBlock(accountId, reason),
        });
      } catch {
        console.info("[fanlink:notif] creator=- ruta=lista n=0 motivo=no se pudo leer status=");
      }
      await sleep(15_000);
    }
  })();
}

async function chatScheduleAccounts(sessions: SessionManager): Promise<ScheduleAccount[]> {
  const [accounts, meta] = await Promise.all([sessions.listAccounts(), listChatMeta(await getSql())]);
  const byCreator = new Map(meta.map((row) => [row.creatorId, row]));
  const intervalMs = (await readChatIntervalMin(await getSql(), chatIntervalMinFromEnv(process.env.FANLINK_CHAT_SYNC_MIN))) * 60_000;
  return accounts.flatMap((account) => {
    if (!account.creatorId) return [];
    const state = byCreator.get(account.creatorId);
    const pause = accountPause(account.id);
    return [
      {
        accountId: account.id,
        creatorId: account.creatorId,
        status: account.status,
        identityState: account.identityState,
        hasStorageState: account.hasStorageState,
        sessionRejected: account.sessionRejected,
        connection: account.connection,
        consecutiveFailures: state?.consecutiveFailures ?? 0,
        lastAttemptAt: pause ? new Date(pause.until - intervalMs).toISOString() : state?.lastAttemptAt ?? null,
      },
    ];
  });
}

async function scheduleAccounts(sessions: SessionManager): Promise<ScheduleAccount[]> {
  const [accounts, meta] = await Promise.all([sessions.listAccounts(), listSyncMeta(await getSql())]);
  const byCreator = new Map(meta.map((row) => [row.creatorId, row]));
  const intervalMs = (await readSyncIntervalMin(await getSql(), intervalMinFromEnv(process.env.FANLINK_SYNC_INTERVAL_MIN))) * 60_000;
  return accounts.flatMap((account) => {
    if (!account.creatorId) return [];
    const state = byCreator.get(account.creatorId);
    const pause = accountPause(account.id);
    return [
      {
        accountId: account.id,
        creatorId: account.creatorId,
        status: account.status,
        identityState: account.identityState,
        hasStorageState: account.hasStorageState,
        sessionRejected: account.sessionRejected,
        connection: account.connection,
        consecutiveFailures: state?.consecutiveFailures ?? 0,
        lastAttemptAt: pause ? new Date(pause.until - intervalMs).toISOString() : state?.lastAttemptAt ?? null,
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
  const config = loadCrmSessionConfig();
  const views = accounts.flatMap((account) => {
    const view = toView(account);
    if (!view) return [];
    if (access.role !== "owner" && !access.creatorIds.includes(view.creatorId)) return [];
    return [view];
  });
  if (access.role !== "owner" || !config.sessionKey) return views;
  return Promise.all(views.map(async (view) => {
    const stored = await readAccountProxy(path.join(config.dataDir, "proxies", `${view.accountId}.bin`), config.sessionKey!);
    return { ...view, proxyLabel: proxyLabel(stored) };
  }));
}

export async function setCreatorProxy(userId: string, creatorId: string, input: unknown): Promise<CreatorSessionView> {
  const access = await accessFor(userId);
  if (access.role !== "owner") throw new WorkspaceAccessError("Solo la dueña guarda el proxy.");
  const id = parseCreatorId(creatorId);
  const sessions = await getOfSessionManager();
  const account = (await sessions.listAccounts()).find((item) => item.creatorId === id);
  if (!account) throw new Error("No hay sesión para esa creadora.");
  const config = loadCrmSessionConfig();
  if (!config.sessionKey) throw new Error("Falta FANLINK_SESSION_KEY.");
  const file = path.join(config.dataDir, "proxies", `${account.id}.bin`);
  if (input == null) await removeAccountProxy(file);
  else await writeAccountProxy(file, parseAccountProxy(input), config.sessionKey);
  const view = toView(account);
  if (!view) throw new Error("La sesión no está ligada a una creadora");
  const stored = await readAccountProxy(file, config.sessionKey);
  return { ...view, proxyLabel: proxyLabel(stored) };
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

export async function listCreatorReadViews(
  userId: string,
  requested: "dashboard" | "chat" | undefined = "dashboard",
): Promise<CreatorReadList> {
  const access = await accessFor(userId);
  const sessions = await getOfSessionManager();
  const accounts = await sessions.listAccounts();
  const creatorIds = creatorIdsForReads(access, accounts, requested);
  const sql = await getSql();
  const rows = await listCreatorReads(sql, creatorIds);
  const running = new Set((await getOfSessionManager()).readingIds());
  return {
    role: access.role,
    intervalMin: await readSyncIntervalMin(sql, intervalMinFromEnv(process.env.FANLINK_SYNC_INTERVAL_MIN)),
    chatIntervalMin: await readChatIntervalMin(sql, chatIntervalMinFromEnv(process.env.FANLINK_CHAT_SYNC_MIN)),
    runningCreatorIds: visibleRunning(accounts, new Set(creatorIds), running),
    creators: rows.map((row) => presentRead(access.role, row)),
  };
}

/** Fichas de los hilos pedidos. Sin lista, no carga todos los fans. */
export async function listChatFanCardViews(
  userId: string,
  threads?: ReadonlyArray<{ creatorId: string; fanKey: string }>,
): Promise<{ fans: ChatFanCard[] }> {
  assertChatFanCardThreadLimit(threads?.length ?? 0);
  const wanted = (threads ?? []).filter((thread) => thread.creatorId && thread.fanKey);
  if (wanted.length === 0) return { fans: [] };
  const access = await accessFor(userId);
  const accounts = await (await getOfSessionManager()).listAccounts();
  const allIds = accounts.flatMap((account) => (account.creatorId ? [account.creatorId] : []));
  const allowed = creatorIdsForChats(access, allIds);
  const creatorIds = allowed.filter((id) => wanted.some((thread) => thread.creatorId === id));
  if (creatorIds.length === 0) return { fans: [] };
  const rows = await listCreatorReads(await getSql(), creatorIds);
  return { fans: chatFanCardsFrom(rows, creatorIds, wanted) };
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
  const accounts = await applyDerivedConnections(sessions, await sessions.listAccounts());
  const creatorIds = creatorIdsForChats(
    access,
    accounts.flatMap((account) => (account.creatorId ? [account.creatorId] : [])),
  );
  const sql = await getSql();
  const stored = await listChats(sql, creatorIds);
  const running = new Set(sessions.readingIds());
  return {
    runningCreatorIds: visibleRunning(accounts, null, running),
    threads: stored.threads.map((thread) => ({
      creatorId: thread.creatorId,
      threadKey: thread.threadKey,
      fanKey: thread.fanKey,
      fanHandle: thread.fanHandle,
      fanName: thread.fanName,
      lastMessageAt: thread.lastMessageAt,
      excerpt: thread.excerpt,
      unread: thread.unread,
      lastFromFan: thread.lastFromFan,
      spentCents: thread.spentCents,
      subscribesCents: thread.subscribesCents,
      tipsCents: thread.tipsCents,
      postsCents: thread.postsCents,
      messagesCents: thread.messagesCents,
      avatarUrl: thread.avatarUrl,
      online: thread.online,
      subPriceCents: thread.subPriceCents,
      subExpiresAt: thread.subExpiresAt,
      renewAuto: thread.renewAuto,
      lists: thread.lists ?? null,
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
      authorId: message.authorId,
      authorName: message.authorName,
      seen: message.seen,
      automatic: message.automatic,
      mediaCount: message.mediaCount ?? null,
      mediaSeconds: message.mediaSeconds ?? null,
      mediaPreview: message.mediaPreview ?? null,
      media: message.media ?? null,
      liked: message.liked ?? null,
      replyBody: message.replyBody ?? null,
      eventKind: message.eventKind ?? null,
      eventCents: message.eventCents ?? null,
    })),
    meta: stored.meta.map((item) => ({
      creatorId: item.creatorId,
      syncedAt: item.syncedAt,
      status: item.status,
      reason: publicSyncReason(item.reason),
    })),
    pending: await listPendingOutbounds(sql, creatorIds),
    profiles: await listFanProfiles(sql, creatorIds),
    notes: await listFanNotes(sql, creatorIds),
    accounts: accounts.flatMap((account) => account.creatorId && creatorIds.includes(account.creatorId) ? [{
      creatorId: account.creatorId,
      sessionRejected: account.sessionRejected,
      connection: account.connection,
    }] : []),
    sessionNotices: accountSessionNotices(
      accounts.flatMap((account) => account.creatorId ? [account] : []),
      creatorIds,
    ),
  };
}

async function applyDerivedConnections(sessions: SessionManager, accounts: readonly Account[]): Promise<Account[]> {
  let ok = new Set<string>();
  try {
    const meta = await listChatMeta(await getSql());
    ok = new Set(meta.filter((row) => row.status === "ok").map((row) => row.creatorId));
  } catch {
    return [...accounts];
  }
  const next: Account[] = [];
  for (const account of accounts) {
    if (account.creatorId && ok.has(account.creatorId) && deriveConnectedFromLastRead(account, true)) {
      next.push(await sessions.recordSignedRead(account.id, 200));
    } else {
      next.push(account);
    }
  }
  return next;
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
  const read = await sessions.readCreatorData(account.id, true, txCursorOf(prior[0]));
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
      spentCents: item.spentCents,
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

export async function listDashboardView(userId: string): Promise<{
  role: "owner" | "member";
  dayGrossCents: number | null;
  monthGrossCents: number | null;
  activeFans: number | null;
  alerts: Array<{ kind: "session" | "sync" | "whale" | "drop"; text: string }>;
}> {
  const access = await accessFor(userId);
  const accounts = await (await getOfSessionManager()).listAccounts();
  const ids = creatorIdsForReads(access, accounts, "dashboard");
  const reads = await listCreatorReads(await getSql(), ids);
  return dashboardViewFor({
    access,
    accounts,
    reads,
    pauses: listAccountPauses(),
    now: new Date(),
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
  const sales = await sql.query<{ creator_id: string; fan_key: string | null; occurred_at: Date | string; gross_cents: number | string }>(
    "select creator_id, fan_key, occurred_at, gross_cents from of_transaction where kind = 'tip'",
  );
  const messages = await sql.query<{
    creator_id: string;
    thread_key: string;
    fan_key: string | null;
    sent_at: Date | string;
    from_fan: boolean | string;
    price_cents: number | string | null;
    purchased: boolean | string | null;
    author_id: string | null;
  }>("select creator_id, thread_key, fan_key, sent_at, from_fan, price_cents, purchased, author_id from of_chat_message");
  const names = await sql.query<{ user_id: string; display_name: string }>("select user_id, display_name from staff_profile");
  const nameOf = new Map(names.map((row) => [row.user_id, row.display_name]));
  const asIso = (value: Date | string) => (value instanceof Date ? value.toISOString() : String(value));
  const chatRows = messages.map((row) => ({
    creatorId: row.creator_id,
    threadKey: row.thread_key,
    fanKey: row.fan_key,
    at: asIso(row.sent_at),
    fromFan: row.from_fan === true || row.from_fan === "t" || row.from_fan === "true",
    priceCents: row.price_cents == null ? null : Number(row.price_cents),
    purchased: row.purchased == null ? null : row.purchased === true || row.purchased === "t" || row.purchased === "true",
    authorId: row.author_id,
  }));
  const ppvSales = chatRows
    .filter((row) => !row.fromFan && row.purchased === true && row.priceCents != null && row.priceCents > 0)
    .map((row) => ({ creatorId: row.creatorId, fanKey: row.fanKey, at: row.at, grossCents: row.priceCents ?? 0, kind: "ppv" as const }));
  return presentTeamMetrics(
    access,
    chatRows,
    [
      ...sales.map((row) => ({
        creatorId: row.creator_id,
        fanKey: row.fan_key,
        at: asIso(row.occurred_at),
        grossCents: Number(row.gross_cents),
        kind: "tip" as const,
      })),
      ...ppvSales,
    ],
    nameOf,
  );
}

export async function saveFanNoteView(
  userId: string,
  input: { creatorId: string; fanKey: string; body: string },
): Promise<{ ok: true }> {
  const access = await accessFor(userId);
  if (access.role !== "owner" && !access.perms.includes("mensajes")) {
    throw new WorkspaceAccessError("No tienes permiso para escribir.");
  }
  if (!input.fanKey.trim()) throw new WorkspaceAccessError("Sin datos del fan.");
  await saveFanNote(await getSql(), { ...input, updatedBy: access.userId });
  return { ok: true };
}

export async function saveFanProfileView(
  userId: string,
  input: {
    creatorId: string;
    fanKey: string;
    nickname: string | null;
    birthday: string | null;
    timezone: string | null;
    source: string | null;
    salaryCents: number | null;
    lastPayDate: string | null;
  },
): Promise<{ ok: true }> {
  const access = await accessFor(userId);
  if (access.role !== "owner" && !access.perms.includes("mensajes")) {
    throw new WorkspaceAccessError("No tienes permiso para escribir.");
  }
  if (!input.fanKey.trim()) throw new WorkspaceAccessError("Sin datos del fan.");
  await saveFanProfile(await getSql(), { ...input, updatedBy: access.userId });
  return { ok: true };
}

export async function recordChatOutboundView(
  userId: string,
  input: { creatorId: string; fanKey: string | null; threadKey: string | null; body: string; priceCents: number | null; ofMessageKey: string | null; scheduledAt?: string | null },
): Promise<{ ok: true; sent: false }> {
  const access = await accessFor(userId);
  if (access.role !== "owner" && !access.perms.includes("mensajes")) {
    throw new WorkspaceAccessError("No tienes permiso para escribir.");
  }
  const body = input.body.replace(/\s+/g, " ").trim();
  if (!body) throw new WorkspaceAccessError("Escribe un mensaje.");
  await recordOutbound(await getSql(), {
    id: crypto.randomUUID(),
    creatorId: input.creatorId,
    threadKey: input.threadKey,
    fanKey: input.fanKey,
    authorId: access.userId,
    body,
    priceCents: input.priceCents,
    createdAt: new Date().toISOString(),
    ofMessageKey: input.ofMessageKey,
    scheduledAt: input.scheduledAt ?? null,
  });
  return { ok: true, sent: false };
}

export async function discardChatOutboundView(userId: string, input: { clientId: string }): Promise<{ ok: true }> {
  const access = await accessFor(userId);
  const { discardOutboundView } = await import("../../server/of-sessions/send/chat-message.ts");
  return discardOutboundView(input, {
    sql: await getSql(),
    access: {
      userId: access.userId,
      role: access.role,
      perms: access.perms,
      creatorIds: access.creatorIds,
    },
  });
}

export async function resolveOnlineOutboundView(userId: string, input: { id: string; outcome: "sent" | "error" }): Promise<{ ok: boolean }> {
  const access = await accessFor(userId);
  if (access.role !== "owner" && !access.perms.includes("mensajes")) {
    throw new WorkspaceAccessError("No tienes permiso para escribir.");
  }
  const sql = await getSql();
  const rows = await sql.query<{ creator_id: string }>("select creator_id from of_chat_outbound where id = $1", [input.id]);
  const creatorId = rows[0]?.creator_id;
  if (!creatorId || !canSeeOnlineFans(access, creatorId)) {
    throw new WorkspaceAccessError("No tienes acceso para operar la sesión de esa creadora.");
  }
  await noteStaleOnlineSends(sql, Date.now());
  return { ok: await resolveStaleOnlineSend(sql, input.id, input.outcome) };
}

export async function reviewChatOutboundView(userId: string, input: { clientId: string }): Promise<{ ok: true }> {
  const access = await accessFor(userId);
  const { reviewAwaitingView } = await import("../../server/of-sessions/send/chat-message.ts");
  return reviewAwaitingView(input, {
    sql: await getSql(),
    access: {
      userId: access.userId,
      role: access.role,
      perms: access.perms,
      creatorIds: access.creatorIds,
    },
  });
}

function cleanTagHandle(value: string | null | undefined): string | null {
  const handle = value?.replace(/^@/, "").trim() ?? "";
  return /^[A-Za-z0-9._]{2,40}$/.test(handle) ? handle : null;
}

export async function chatSendAccessView(userId: string): Promise<{ creatorIds: string[] }> {
  const access = await accessFor(userId);
  if (access.role !== "owner" && !access.perms.includes("mensajes")) return { creatorIds: [] };
  const sessions = await getOfSessionManager();
  const accounts = await sessions.listAccounts();
  return {
    creatorIds: accounts.flatMap((account) => {
      const allowed = chatSendGate(process.env.FANLINK_ENABLE_SEND, process.env.FANLINK_SEND_ALLOW_ACCOUNTS, sendAccount(account)).allowed;
      return allowed && account.creatorId ? [account.creatorId] : [];
    }),
  };
}

export async function resolveChatSendHooks(
  userId: string,
  input: { creatorId: string; fanKey: string | null; threadKey: string | null; body: string; priceCents: number | null; vaultItemIds?: string[]; tagHandle?: string | null },
): Promise<SendChatHooks> {
  const access = await accessFor(userId);
  const sessions = await getOfSessionManager();
  const accounts = await sessions.listAccounts();
  const known = accounts.flatMap((item) => item.creatorId ? [item.creatorId] : []);
  const account = accounts.find((item) => item.creatorId === input.creatorId) ?? null;
  const vaultPieces: SendChatHooks["vaultPieces"] = [];
  return {
    sql: await getSql(),
    access: { userId: access.userId, role: access.role, perms: access.perms, creatorIds: known },
    account: account ? {
      id: account.id,
      creatorId: account.creatorId,
      identityHandle: account.identityHandle,
      identityUserId: account.identityUserId,
      identityState: account.identityState,
      label: account.label,
    } : null,
    env: process.env,
    vaultPieces,
    open: () => {
      if (!account) return Promise.resolve({ messageId: null, reason: "Envío real desactivado" });
      return sessions.withSession(account.id, (context) => composeChat(context, {
        chatsUrl: onlyFansSite.chatsUrl ?? "https://onlyfans.com/my/chats",
        siteId: onlyFansSite.id,
        threadKey: input.threadKey ?? "",
        fanKey: input.fanKey,
        accountUserId: account.identityUserId,
        body: input.body,
        priceCents: input.priceCents,
        vaultPieces,
        tagHandle: cleanTagHandle(input.tagHandle),
        typeDelayMs: null,
      }));
    },
  };
}

export async function readChatVaultView(
  userId: string,
  input: { creatorId: string; threadKey: string; listId?: string; offset?: number },
  deps?: Partial<VaultReadDeps>,
): Promise<{ items: VaultFile[]; reason: string | null }> {
  const access = deps?.access ?? await accessFor(userId);
  if (access.role !== "owner" && !access.perms.includes("mensajes")) {
    throw new WorkspaceAccessError("No tienes permiso para escribir.");
  }
  return readVaultPage(input, {
    fetch: deps?.fetch ?? fetch,
    now: deps?.now ?? (() => Date.now()),
    sql: deps?.sql ?? await getSql(),
    sessions: deps?.sessions ?? await getOfSessionManager(),
    access,
    openBrowser: deps?.openBrowser,
  });
}

export async function listOnlineFansView(userId: string, input: { creatorId: string }): Promise<{ fans: OnlineFan[]; reason: string | null; notices: string[]; cap: number; send: { enabled: boolean; reason: string | null } }> {
  const access = await accessFor(userId);
  if (input.creatorId !== "all" && !canSeeOnlineFans(access, input.creatorId)) {
    throw new WorkspaceAccessError("No tienes acceso para operar la sesión de esa creadora.");
  }
  if (input.creatorId === "all" && access.role !== "owner" && !access.perms.includes("mensajes")) {
    return { fans: [], reason: "Sin datos", notices: [], cap: ONLINE_FAN_CAP, send: { enabled: false, reason: "Sin datos" } };
  }
  const sessions = await getOfSessionManager();
  const accounts = await sessions.listAccounts();
  const known = accounts.flatMap((account) => account.creatorId ? [account.creatorId] : []);
  const wanted = visibleOnlineCreatorIds(access, input.creatorId, known);
  if (wanted.length === 0) return { fans: [], reason: "Sin datos", notices: [], cap: ONLINE_FAN_CAP, send: { enabled: false, reason: "Sin datos" } };
  await noteStaleOnlineSends(await getSql(), Date.now());
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

export async function cancelOnlineBroadcastView(
  userId: string,
  input: { creatorId: string; batchId: string },
): Promise<{ cancelled: boolean }> {
  const access = await accessFor(userId);
  if (!canSeeOnlineFans(access, input.creatorId)) {
    throw new WorkspaceAccessError("No tienes acceso para operar la sesión de esa creadora.");
  }
  return { cancelled: cancelOnlineBroadcast(input.batchId, access.userId, input.creatorId) };
}

export async function broadcastOnlineFansView(
  userId: string,
  input: { creatorId: string; fanKeys: string[]; text: string; priceCents: number | null; vaultItemIds?: string[]; batchId: string },
): Promise<OnlineBroadcastResult> {
  const access = await accessFor(userId);
  if (!canSeeOnlineFans(access, input.creatorId)) {
    throw new WorkspaceAccessError("No tienes acceso para operar la sesión de esa creadora.");
  }
  const sessions = await getOfSessionManager();
  const account = (await sessions.listAccounts()).find((item) => item.creatorId === input.creatorId);
  if (!account) return emptyOnlineBroadcast("Sin datos");
  if (signedReadsBlocked(account)) return emptyOnlineBroadcast(SESSION_EXPIRED_LABEL);
  const fields = {
    creatorId: account.creatorId,
    accountId: account.id,
    handle: account.identityHandle,
    userId: account.identityUserId,
    label: account.label,
  };
  const blocked = refuseOnlineBroadcast({
    env: process.env,
    account: fields,
    text: input.text,
    priceCents: input.priceCents,
    vaultReason: null,
  });
  if (blocked) return emptyOnlineBroadcast(blocked);
  const vaultIds = (input.vaultItemIds ?? []).map((item) => item.trim()).filter(Boolean);
  const planned = await prepareVaultSend(await getSql(), input.creatorId, vaultIds);
  if (!planned.ok) return emptyOnlineBroadcast(planned.reason);
  const mediaIds: number[] = [];
  for (const piece of planned.pieces) {
    if (!/^[0-9]{1,18}$/.test(piece.id)) return emptyOnlineBroadcast("Sin datos");
    mediaIds.push(Number(piece.id));
  }
  let state;
  try {
    state = await sessions.readStorageState(account.id);
  } catch {
    return emptyOnlineBroadcast("No se pudo leer.");
  }
  const auth = sessionForApi(state, Date.now());
  if ("reason" in auth) return emptyOnlineBroadcast("No se pudo leer.");
  let rules;
  try {
    rules = await loadSignRules(fetch, Date.now());
  } catch {
    return emptyOnlineBroadcast("No se pudo leer.");
  }
  const fresh = await withAccountApi(account.id, () => fetchSignedOnlineFans(state, { fetch, now: () => Date.now(), rules }));
  if (fresh.fans.length === 0 && fresh.reason && fresh.reason !== "Nadie en línea") {
    return emptyOnlineBroadcast(fresh.reason);
  }
  const sql = await getSql();
  const body = input.text.replace(/\s+/g, " ").trim();
  const batchId = input.batchId.trim();
  return sendOnlineBroadcast({
    env: process.env,
    account: fields,
    userId: access.userId,
    batchId,
    auth,
    rules,
    requested: input.fanKeys,
    online: fresh.fans,
    text: body,
    mediaIds,
    priceCents: input.priceCents,
    vaultReason: null,
    fetch,
    now: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => {
      setTimeout(resolve, ms);
    }),
    claim: (fanKey) => sql.isolate((pinned) => claimOnlineOutbound(pinned, {
      batchId,
      creatorId: input.creatorId,
      fanKey,
      authorId: access.userId,
      body,
      priceCents: input.priceCents,
      mediaIds,
      nowMs: Date.now(),
    })),
    finish: (id, status, messageId, why) => finishOnlineOutbound(sql, id, status, messageId, why),
  });
}

export async function runFanChatMenuView(userId: string, input: { creatorId: string; fanKey: string; request: unknown }): Promise<FanMenuResult> {
  const access = await accessFor(userId);
  if (access.role !== "owner" && !access.perms.includes("mensajes")) {
    throw new WorkspaceAccessError("No tienes permiso para escribir.");
  }
  const request = normalizeFanMenuRequest(input.request);
  if (!request || !input.fanKey.trim()) return { ok: false, reason: "Sin datos", lists: [] };
  const sessions = await getOfSessionManager();
  const account = (await sessions.listAccounts()).find((item) => item.creatorId === input.creatorId);
  if (!account) return { ok: false, reason: "Sin datos", lists: [] };
  const url = chatPageUrl(onlyFansSite.chatsUrl ?? "https://onlyfans.com/my/chats", input.fanKey, "onlyfans");
  const ran = await sessions.runQueued(account.id, async (context) => {
    const page = await openWorkPage(context);
    try {
      return await runFanMenuOnPage(page, url, request);
    } finally {
      await page.close().catch(() => undefined);
    }
  }, { wait: true });
  if (!ran.ok) return { ok: false, reason: "OnlyFans está ocupado con otra lectura.", lists: [] };
  return ran.value;
}

export async function markChatOpenedView(userId: string, input: { creatorId: string; threadKey: string }): Promise<{ marked: boolean }> {
  const access = await accessFor(userId);
  if (access.role !== "owner" && !access.perms.includes("mensajes")) {
    throw new WorkspaceAccessError("No tienes permiso para escribir.");
  }
  const creatorId = parseCreatorId(input.creatorId);
  const sessions = await getOfSessionManager();
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
    sql: await getSql(),
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

export async function loadOlderMessagesView(userId: string, input: { creatorId: string; threadKey: string }): Promise<{ ok: boolean }> {
  const access = await accessFor(userId);
  if (access.role !== "owner" && !access.perms.includes("mensajes")) {
    throw new WorkspaceAccessError("No tienes permiso para escribir.");
  }
  const sessions = await getOfSessionManager();
  const account = (await sessions.listAccounts()).find((item) => item.creatorId === input.creatorId);
  if (!account) return { ok: false };
  await pullOlder(sessions, account.id, input.creatorId, input.threadKey, account.identityUserId);
  return { ok: true };
}

export async function loadMoreChatsView(userId: string, input: { creatorId: string }): Promise<{ ok: boolean }> {
  const access = await accessFor(userId);
  if (access.role !== "owner" && !access.perms.includes("mensajes")) {
    throw new WorkspaceAccessError("No tienes permiso para escribir.");
  }
  const sessions = await getOfSessionManager();
  const account = (await sessions.listAccounts()).find((item) => item.creatorId === input.creatorId);
  if (!account) return { ok: false };
  const sql = await getSql();
  const previous = (await listChats(sql, [input.creatorId])).threads.map((thread) => thread.threadKey);
  const ran = await sessions.runQueued(account.id, async (context) => {
    const page = await context.newPage();
    try {
      await page.goto(onlyFansSite.chatsUrl ?? "https://onlyfans.com/my/chats", { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => undefined);
      return await captureChatListPage(page, account.identityUserId);
    } finally {
      await page.close().catch(() => undefined);
    }
  });
  if (!ran.ok) return { ok: false };
  const done = listPageDone(previous, ran.value);
  if (ran.value.length > 0) {
    await saveChatRead(sql, input.creatorId, { threads: ran.value, messages: [], reason: null, jsonPaths: [] });
  }
  await markChatList(sql, input.creatorId, ran.value.at(-1)?.threadKey ?? null, done);
  return { ok: true };
}

export async function openLiveViewTicket(
  userId: string,
  input: { creatorId: string; threadKey: string; fanKey: string | null },
): Promise<{ ok: boolean; ticket: string | null; reason: string | null }> {
  const access = await accessFor(userId);
  if (access.role !== "owner" && !access.perms.includes("mensajes")) {
    throw new WorkspaceAccessError("No tienes permiso para escribir.");
  }
  const threadKey = input.threadKey.trim() || "inbox";
  const sessions = await getOfSessionManager();
  const account = (await sessions.listAccounts()).find((item) => item.creatorId === input.creatorId);
  if (!account) return { ok: false, ticket: null, reason: "Vista en directo desactivada" };
  const gate = liveViewGate(process.env.FANLINK_LIVE_VIEW_ENABLED, process.env.FANLINK_SEND_ALLOW_ACCOUNTS, sendAccount(account));
  if (!gate.allowed) return { ok: false, ticket: null, reason: gate.reason };
  const ticket = issueLiveTicket({
    userId,
    accountId: account.id,
    creatorId: input.creatorId,
    threadKey,
    fanKey: input.fanKey,
    accountUserId: account.identityUserId,
  });
  return { ok: true, ticket, reason: null };
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

function txCursorOf(row: { txCursor: string | null; txCursorKey: string | null } | undefined) {
  if (!row?.txCursor) return null;
  return { at: row.txCursor, key: row.txCursorKey ?? "" };
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
    proxyLabel: null,
  };
}
