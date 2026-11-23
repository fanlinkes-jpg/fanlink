import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { canReadCreatorNotifications, ofNoticeTotal, type NotificationCounts, type NotificationKind, type NotificationLabels, type NotificationTab } from "@/lib/notifications";
import { SESSION_EXPIRED_LABEL, signedReadsBlocked } from "../../server/of-sessions/sync/session-link.ts";

// Los módulos de base y de disco solo se cargan dentro del handler: si fueran
// un import de arriba, el cliente arrastraría el servidor al navegador.

export type NotificationListItem = {
  key: string;
  kind: NotificationKind;
  tab: NotificationTab;
  body: string | null;
  fanKey: string | null;
  fanName: string | null;
  threadKey: string | null;
  amountCents: number | null;
  occurredAt: string | null;
  pending: boolean;
  seen: boolean;
  ofUnread: boolean | null;
  fanHandle: string | null;
  avatarUrl: string | null;
  lists: string[] | null;
  renewAuto: boolean | null;
  fanSeenAt: string | null;
  postRef: string | null;
  postLink: string | null;
  postText: string | null;
  ofType: string | null;
  messageRef: string | null;
  labels: NotificationLabels;
};

export type NotificationList = {
  role: "owner" | "member";
  syncedAt: string | null;
  items: NotificationListItem[];
  nextCursor: string | null;
  counts: NotificationCounts | null;
  motivo: string | null;
  status: number | null;
  markOnOnlyfans: boolean;
  fanlinkUnread: number | null;
  /** Cuenta con la sesión caducada. No es un cero de avisos. */
  sessionNotice: string | null;
};

export type NotificationMarkResult = {
  updated: number;
  keys: string[];
  counts: NotificationCounts | null;
  motivo: string | null;
  cleared: boolean;
  markOnOnlyfans: boolean;
  fanlinkUnread: number | null;
};

export const ensureNoticeTab = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { creatorId: string; tab: NotificationTab }) => input)
  .handler(async ({ context, data }) => {
    const { ensureNotificationTabView } = await import("./of-sessions-runtime.server");
    return ensureNotificationTabView(context.userId, data);
  });

export const listCreatorNotifications = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((input: { creatorId: string; cursor?: string | null; tab?: NotificationTab | null }) => input)
  .handler(async ({ context, data }): Promise<NotificationList> => {
    const { getSql } = await import("@/lib/db");
    const { ensureStaff } = await import("@/lib/workspace-store");
    const { DEV_USER_ID, authConfigured } = await import("@/lib/auth/verify.server");
    const { notificationPageFor } = await import("../../server/of-sessions/sync/notification-store.ts");
    const sql = await getSql();
    const devMode = !authConfigured && context.userId === DEV_USER_ID;
    const access = await ensureStaff(sql, context.userId, devMode);
    const page = await notificationPageFor(sql, access, data.creatorId, data.cursor, data.tab);
    const { getOfSessionManager } = await import("./of-sessions-runtime.server");
    let sessionNotice: string | null = null;
    try {
      const account = (await (await getOfSessionManager()).listAccounts()).find((item) => item.creatorId === data.creatorId);
      if (account && signedReadsBlocked(account)) sessionNotice = `${data.creatorId}: ${SESSION_EXPIRED_LABEL}`;
    } catch {
      sessionNotice = null;
    }
    return { ...page, markOnOnlyfans: await markReadEnabled(data.creatorId), sessionNotice };
  });

export const markCreatorNotificationsRead = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { creatorId: string; keys: string[] | null }) => input)
  .handler(async ({ context, data }): Promise<NotificationMarkResult> => {
    const { getSql } = await import("@/lib/db");
    const { ensureStaff } = await import("@/lib/workspace-store");
    const { DEV_USER_ID, authConfigured } = await import("@/lib/auth/verify.server");
    const { markableNotifications, markNotificationsSeen, saveNotificationRead, countFanlinkUnread, notificationSyncState } = await import("../../server/of-sessions/sync/notification-store.ts");
    const { visibleMarkScope } = await import("@/lib/notifications");
    const { notificationLogLine } = await import("../../server/of-sessions/sync/of-notifications-api.ts");
    const { getOfSessionManager } = await import("@/lib/of-sessions-runtime.server");
    const sql = await getSql();
    const devMode = !authConfigured && context.userId === DEV_USER_ID;
    const access = await ensureStaff(sql, context.userId, devMode);
    const visible = await markableNotifications(sql, access, data.creatorId, data.keys);
    const updated = await markNotificationsSeen(sql, data.creatorId, access.userId, visible.map((row) => row.key));
    const scope = visibleMarkScope(visible.map((row) => row.kind), access.role, data.keys == null);
    const sync = await notificationSyncState(sql, data.creatorId);
    const fanlinkUnread = sync.ok ? await countFanlinkUnread(sql, data.creatorId, access.userId, access.role) : null;
    const sessions = await getOfSessionManager();
    const account = (await sessions.listAccounts()).find((item) => item.creatorId === data.creatorId);
    if (!account) {
      console.info(notificationLogLine({ creatorId: data.creatorId, route: "marcar", count: 0, motivo: "marcado apagado", status: null }));
      return { updated, keys: visible.map((row) => row.key), counts: null, motivo: "marcado apagado", cleared: false, markOnOnlyfans: false, fanlinkUnread };
    }
    const marked = await sessions.markNotificationsOnOnlyfans(account.id, scope);
    for (const route of marked.routes) {
      console.info(notificationLogLine({ creatorId: data.creatorId, route: route.route, count: route.count, motivo: route.motivo, status: route.status }));
    }
    const cleared = marked.counts?.all === 0;
    if (marked.counts) {
      await saveNotificationRead(sql, data.creatorId, { items: [], reason: null, captured: true, counts: marked.counts, status: 200, motivo: "ok" });
    }
    return {
      updated,
      keys: visible.map((row) => row.key),
      counts: marked.counts,
      motivo: marked.motivo,
      cleared,
      markOnOnlyfans: marked.motivo !== "marcado apagado",
      fanlinkUnread,
    };
  });

export const listCreatorNoticeBadges = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((input: { creatorIds?: string[] } | undefined) => {
    const ids = [...new Set((input?.creatorIds ?? []).map((id) => id.trim()).filter((id) => id && id !== "all"))].slice(0, 24);
    return { creatorIds: ids };
  })
  .handler(async ({ context, data }): Promise<{ badges: Array<{ creatorId: string; unread: number | null }> }> => {
    const { getSql } = await import("@/lib/db");
    const { ensureStaff } = await import("@/lib/workspace-store");
    const { DEV_USER_ID, authConfigured } = await import("@/lib/auth/verify.server");
    const { notificationPageFor } = await import("../../server/of-sessions/sync/notification-store.ts");
    const sql = await getSql();
    const devMode = !authConfigured && context.userId === DEV_USER_ID;
    const access = await ensureStaff(sql, context.userId, devMode);
    const badges: Array<{ creatorId: string; unread: number | null }> = [];
    for (const creatorId of data.creatorIds) {
      if (!canReadCreatorNotifications(access, creatorId)) continue;
      const page = await notificationPageFor(sql, access, creatorId);
      badges.push({ creatorId, unread: ofNoticeTotal(page.counts) });
    }
    return { badges };
  });

export type PurchaseMessageCard = {
  messageId: string;
  threadKey: string;
  body: string;
  priceCents: number | null;
  media: Array<{ kind: "foto" | "video" | "audio" | null; seconds: number | null }>;
  retryAfterMs: number;
};

export const readPurchaseMessage = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((input: { creatorId: string; messageRef: string; fanKey: string | null }) => input)
  .handler(async ({ context, data }): Promise<PurchaseMessageCard | null> => {
    const { getSql } = await import("@/lib/db");
    const { ensureStaff } = await import("@/lib/workspace-store");
    const { DEV_USER_ID, authConfigured } = await import("@/lib/auth/verify.server");
    const { canReadCreatorNotifications } = await import("@/lib/notifications");
    const { parseMessageRef, readMirroredPurchase, fetchPurchaseMessage, savePurchasedMessage } = await import("../../server/of-sessions/sync/purchase-message.ts");
    const sql = await getSql();
    const devMode = !authConfigured && context.userId === DEV_USER_ID;
    const access = await ensureStaff(sql, context.userId, devMode);
    if (!canReadCreatorNotifications(access, data.creatorId)) return null;
    const ref = parseMessageRef(data.messageRef);
    if (!ref.messageId) return null;
    const mirrored = await readMirroredPurchase(sql, data.creatorId, ref.messageId);
    if (mirrored) {
      return {
        messageId: mirrored.messageKey,
        threadKey: mirrored.threadKey,
        body: mirrored.body,
        priceCents: mirrored.priceCents,
        media: (mirrored.media ?? []).map((item) => ({ kind: item.kind, seconds: item.seconds })),
        retryAfterMs: 0,
      };
    }
    const fanId = ref.threadId ?? data.fanKey;
    if (!fanId || !/^\d{1,18}$/.test(fanId)) return null;
    const { getOfSessionManager } = await import("@/lib/of-sessions-runtime.server");
    const { sessionForApi, signedHeaders } = await import("../../server/of-sessions/sync/of-chat-api.ts");
    const { loadSignRules } = await import("../../server/of-sessions/sync/of-sign.ts");
    const { awaitAccountGap, withAccountApi } = await import("../../server/of-sessions/sync/api-list-pace.ts");
    const sessions = await getOfSessionManager();
    const account = (await sessions.listAccounts()).find((item) => item.creatorId === data.creatorId);
    if (!account) return null;
    let state;
    try {
      state = await sessions.readStorageState(account.id);
    } catch {
      return null;
    }
    const auth = sessionForApi(state, Date.now());
    if ("reason" in auth) return null;
    const rules = await loadSignRules(fetch, Date.now());
    const loaded = await fetchPurchaseMessage({
      fanId,
      messageId: ref.messageId,
      threadKey: ref.threadId ?? fanId,
      accountUserId: account.identityUserId,
      request: (path) => withAccountApi(account.id, async () => {
        await awaitAccountGap(account.id, () => Date.now(), (ms) => new Promise((resolve) => setTimeout(resolve, ms)));
        const response = await fetch(`https://onlyfans.com${path}`, {
          headers: signedHeaders(rules, path, auth, Date.now()),
        });
        if (response.status === 429) {
          const retry = Number(response.headers.get("retry-after"));
          return { status: 429, body: null, retryAfterMs: Number.isFinite(retry) && retry > 0 ? retry * 1000 : 1_500 };
        }
        const body = response.ok ? await response.json().catch(() => null) : null;
        return { status: response.status, body, retryAfterMs: 0 };
      }),
    });
    if (!loaded.message) return { messageId: ref.messageId, threadKey: ref.threadId ?? fanId, body: "", priceCents: null, media: [], retryAfterMs: loaded.retryAfterMs };
    await savePurchasedMessage(sql, data.creatorId, loaded.message);
    return {
      messageId: loaded.message.messageKey,
      threadKey: loaded.message.threadKey,
      body: loaded.message.body,
      priceCents: loaded.message.priceCents,
      media: (loaded.message.media ?? []).map((item) => ({ kind: item.kind, seconds: item.seconds })),
      retryAfterMs: loaded.retryAfterMs,
    };
  });

async function markReadEnabled(creatorId: string): Promise<boolean> {
  const { getOfSessionManager } = await import("@/lib/of-sessions-runtime.server");
  const { notificationMarkReadGate } = await import("../../server/of-sessions/send/gate.ts");
  const sessions = await getOfSessionManager();
  const account = (await sessions.listAccounts()).find((item) => item.creatorId === creatorId);
  if (!account) return false;
  return notificationMarkReadGate(process.env.FANLINK_NOTIF_MARK_READ, process.env.FANLINK_SEND_ALLOW_ACCOUNTS, {
    creatorId: account.creatorId,
    accountId: account.id,
    handle: account.identityHandle,
    userId: account.identityUserId,
    label: account.label,
  }).allowed;
}
