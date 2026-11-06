import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import type { NotificationKind, NotificationLabels, NotificationTab } from "@/lib/notifications";

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
    const { notificationPageFor } = await import("../../server/of-sessions/sync/notification-store.ts");
    const sql = await getSql();
    const devMode = !authConfigured && context.userId === DEV_USER_ID;
    const access = await ensureStaff(sql, context.userId, devMode);
    return notificationPageFor(sql, access, data.creatorId, data.cursor);
  });

export const markCreatorNotificationsRead = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { creatorId: string; keys: string[] | null }) => input)
  .handler(async ({ context, data }): Promise<{ updated: number }> => {
    const { getSql } = await import("@/lib/db");
    const { ensureStaff } = await import("@/lib/workspace-store");
    const { DEV_USER_ID, authConfigured } = await import("@/lib/auth/verify.server");
    const { markNotificationPage } = await import("../../server/of-sessions/sync/notification-store.ts");
    const sql = await getSql();
    const devMode = !authConfigured && context.userId === DEV_USER_ID;
    const access = await ensureStaff(sql, context.userId, devMode);
    const updated = await markNotificationPage(sql, access, data.creatorId, data.keys);
    return { updated };
  });
