import { createServerFn } from "@tanstack/react-start";
import { WorkspaceAccessError } from "@/lib/access-policy";
import { authMiddleware } from "@/lib/auth/middleware";
import {
  canReadCreatorNotifications,
  isFanSpendKind,
  isOwnerOnlyKind,
  notificationLabels,
  tabOf,
  visibleNotifications,
  type NotificationKind,
  type NotificationLabels,
  type NotificationTab,
} from "@/lib/notifications";

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
  labels: NotificationLabels;
};

export type NotificationList = {
  role: "owner" | "member";
  syncedAt: string | null;
  items: NotificationListItem[];
  nextCursor: string | null;
};

export const listCreatorNotifications = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((input: { creatorId: string; cursor?: string | null }) => input)
  .handler(async ({ context, data }): Promise<NotificationList> => {
    const { getSql } = await import("@/lib/db");
    const { ensureStaff } = await import("@/lib/workspace-store");
    const { DEV_USER_ID, authConfigured } = await import("@/lib/auth/verify.server");
    const { listNotificationRows, notificationSyncedAt } = await import("../../server/of-sessions/sync/notification-store.ts");
    const sql = await getSql();
    const devMode = !authConfigured && context.userId === DEV_USER_ID;
    const access = await ensureStaff(sql, context.userId, devMode);
    if (!canReadCreatorNotifications(access, data.creatorId)) {
      return { role: access.role, syncedAt: null, items: [], nextCursor: null };
    }
    const [page, syncedAt] = await Promise.all([
      listNotificationRows(sql, data.creatorId, access.userId, { cursor: data.cursor }),
      notificationSyncedAt(sql, data.creatorId),
    ]);
    const visible = visibleNotifications(page.rows, access, data.creatorId);
    return {
      role: access.role,
      syncedAt,
      nextCursor: page.nextCursor,
      items: visible.flatMap((row) => {
        const labels = notificationLabels(row, access.role);
        if (!labels) return [];
        return [
          {
            key: row.key,
            kind: row.kind,
            tab: tabOf(row.kind),
            body: row.body,
            fanKey: row.fanKey,
            fanName: row.fanName,
            threadKey: row.threadKey,
            amountCents: access.role === "owner" || isFanSpendKind(row.kind) ? row.amountCents : null,
            occurredAt: row.occurredAt,
            pending: row.pending,
            seen: Boolean(row.seenAt),
            labels,
          },
        ];
      }),
    };
  });

export const markCreatorNotificationsRead = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { creatorId: string; keys: string[] | null }) => input)
  .handler(async ({ context, data }): Promise<{ updated: number }> => {
    const { getSql } = await import("@/lib/db");
    const { ensureStaff } = await import("@/lib/workspace-store");
    const { DEV_USER_ID, authConfigured } = await import("@/lib/auth/verify.server");
    const { notificationKinds, markNotificationsSeen } = await import("../../server/of-sessions/sync/notification-store.ts");
    const sql = await getSql();
    const devMode = !authConfigured && context.userId === DEV_USER_ID;
    const access = await ensureStaff(sql, context.userId, devMode);
    if (!canReadCreatorNotifications(access, data.creatorId)) {
      throw new WorkspaceAccessError("No tienes esa cuenta.");
    }
    const visible = new Set(
      (await notificationKinds(sql, data.creatorId, data.keys ?? []))
        .filter((row) => access.role === "owner" || !isOwnerOnlyKind(row.kind))
        .map((row) => row.key),
    );
    const keys = (data.keys ?? []).filter((key) => visible.has(key));
    const updated = await markNotificationsSeen(sql, data.creatorId, access.userId, keys);
    return { updated };
  });
