import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import type { NotificationCounts, NotificationKind, NotificationLabels, NotificationTab } from "@/lib/notifications";

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
};

export type NotificationMarkResult = {
  updated: number;
  keys: string[];
  counts: NotificationCounts | null;
  motivo: string | null;
  cleared: boolean;
  markOnOnlyfans: boolean;
};

export const listCreatorNotifications = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((input: { creatorId: string; cursor?: string | null }) => input)
  .handler(async ({ context, data }): Promise<NotificationList> => {
    const { getSql } = await import("@/lib/db");
    const { ensureStaff } = await import("@/lib/workspace-store");
    const { DEV_USER_ID, authConfigured } = await import("@/lib/auth/verify.server");
    const { notificationPageFor } = await import("../../server/of-sessions/sync/notification-store.ts");
    const sql = await getSql();
    const devMode = !authConfigured && context.userId === DEV_USER_ID;
    const access = await ensureStaff(sql, context.userId, devMode);
    const page = await notificationPageFor(sql, access, data.creatorId, data.cursor);
    return { ...page, markOnOnlyfans: await markReadEnabled(data.creatorId) };
  });

export const markCreatorNotificationsRead = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { creatorId: string; keys: string[] | null }) => input)
  .handler(async ({ context, data }): Promise<NotificationMarkResult> => {
    const { getSql } = await import("@/lib/db");
    const { ensureStaff } = await import("@/lib/workspace-store");
    const { DEV_USER_ID, authConfigured } = await import("@/lib/auth/verify.server");
    const { markableNotifications, markNotificationsSeen, saveNotificationRead } = await import("../../server/of-sessions/sync/notification-store.ts");
    const { visibleMarkScope } = await import("@/lib/notifications");
    const { notificationLogLine } = await import("../../server/of-sessions/sync/of-notifications-api.ts");
    const { getOfSessionManager } = await import("@/lib/of-sessions-runtime.server");
    const { notificationMarkReadGate } = await import("../../server/of-sessions/send/gate.ts");
    const sql = await getSql();
    const devMode = !authConfigured && context.userId === DEV_USER_ID;
    const access = await ensureStaff(sql, context.userId, devMode);
    const visible = await markableNotifications(sql, access, data.creatorId, data.keys);
    const updated = await markNotificationsSeen(sql, data.creatorId, access.userId, visible.map((row) => row.key));
    const scope = visibleMarkScope(visible.map((row) => row.kind), access.role, data.keys == null);
    const sessions = await getOfSessionManager();
    const account = (await sessions.listAccounts()).find((item) => item.creatorId === data.creatorId);
    const allowed = account ? notificationMarkReadGate(process.env.FANLINK_NOTIF_MARK_READ, process.env.FANLINK_SEND_ALLOW_ACCOUNTS, {
      creatorId: account.creatorId,
      accountId: account.id,
      handle: account.identityHandle,
      userId: account.identityUserId,
      label: account.label,
    }).allowed : false;
    if (!account || !allowed) {
      console.info(notificationLogLine({ creatorId: data.creatorId, route: "marcar", count: 0, motivo: "marcado apagado", status: null }));
      return { updated, keys: visible.map((row) => row.key), counts: null, motivo: "marcado apagado", cleared: false, markOnOnlyfans: false };
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
      markOnOnlyfans: true,
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
