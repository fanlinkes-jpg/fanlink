import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import type { SessionStatus } from "../../server/of-sessions/types.ts";

export type { SessionStatus };
export {
  CONNECTION_LABEL,
  IDENTITY_STATE_LABEL,
  SESSION_STATUS_LABEL,
  sessionActionLabel,
} from "../../server/of-sessions/status.ts";

/** Estado de la sesión de OnlyFans de una creadora. No incluye cookies. */
export type CreatorSessionView = {
  creatorId: string;
  accountId: string;
  label: string;
  status: SessionStatus;
  loginInProgress: boolean;
  sessionRejected: boolean;
  hasStorageState: boolean;
  connection: "not_checked" | "live" | "rejected" | "inconclusive" | "login_required";
  identityState: "unavailable" | "verified" | "mismatch";
  identityLabel: string | null;
  identityHandle: string | null;
  identityName: string | null;
  identityUserId: string | null;
  identityCheckedAt: string | null;
  identityReason: string | null;
  readsBlocked: boolean;
  lastCheckedAt: string | null;
  lastError: string | null;
  proxyLabel: string | null;
};

export type ConnectCreatorInput = {
  creatorId: string;
  label: string;
  platform?: string;
};

/**
 * Lista el estado real de cada sesión ligada a una creadora.
 * La entrada del equipo (better-auth) va por authMiddleware; no es la sesión de OnlyFans.
 */
export const listCreatorSessions = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<CreatorSessionView[]> => {
    // Playwright y el disco solo se cargan en el servidor.
    const { listCreatorSessionViews } =
      await import("./of-sessions-runtime.server");
    return listCreatorSessionViews(context.userId);
  });

/**
 * Abre la ventana visible de Chromium para que la dueña entre en OnlyFans.
 * Rechaza cualquier campo de contraseña o usuario.
 */
export const connectCreatorSession = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: ConnectCreatorInput) => input)
  .handler(async ({ context, data }): Promise<CreatorSessionView> => {
    const { connectCreator } = await import("./of-sessions-runtime.server");
    return connectCreator(context.userId, data);
  });

export type EarningKind = "total" | "subscription" | "tip" | "message" | "post";

export type CreatorEarningView = {
  day: string;
  kind: EarningKind;
  amountCents: number;
  currency: string;
};

export type CreatorFanView = {
  fanKey: string;
  ofUserId: string | null;
  handle: string | null;
  displayName: string | null;
  subscribedAt: string | null;
  status: "active" | "expired";
  spentCents: number | null;
  renewAuto: boolean | null;
  expiresAt: string | null;
};

export type CreatorTransactionView = {
  txKey: string;
  occurredAt: string;
  grossCents: number;
  netCents: number | null;
  kind: "subscription" | "renewal" | "tip" | "message" | "post" | "stream" | "referral";
  fanKey: string | null;
  currency: string;
};

/** Lectura guardada de OnlyFans. `earnings` es null si quien mira no es la dueña. */
export type CreatorReadView = {
  creatorId: string;
  earningsSyncedAt: string | null;
  fansSyncedAt: string | null;
  lastReason: string | null;
  lastAttemptAt: string | null;
  consecutiveFailures: number;
  lastStatus: "idle" | "ok" | "error";
  earnings: CreatorEarningView[] | null;
  fans: CreatorFanView[];
  /** Null si quien mira no es la dueña. */
  transactions: CreatorTransactionView[] | null;
};

export type CreatorReadList = {
  role: "owner" | "member";
  intervalMin: number;
  chatIntervalMin: number;
  runningCreatorIds: string[];
  creators: CreatorReadView[];
};

export type CreatorChatList = {
  runningCreatorIds: string[];
  threads: Array<{
    creatorId: string;
    threadKey: string;
    fanKey: string | null;
    fanHandle: string | null;
    fanName: string | null;
    lastMessageAt: string | null;
    excerpt: string | null;
    unread: number;
    lastFromFan: boolean | null;
    spentCents: number | null;
    subscribesCents: number | null;
    tipsCents: number | null;
    postsCents: number | null;
    messagesCents: number | null;
    avatarUrl: string | null;
    online: boolean | null;
    subPriceCents: number | null;
    subExpiresAt: string | null;
    renewAuto: boolean | null;
  }>;
  messages: Array<{
    creatorId: string;
    threadKey: string;
    messageKey: string;
    fanKey: string | null;
    fromFan: boolean;
    body: string;
    sentAt: string;
    priceCents: number | null;
    purchased: boolean | null;
    authorId: string | null;
    authorName: string | null;
    seen: boolean | null;
    automatic: boolean | null;
    media: Array<{
      kind: "foto" | "video" | "audio" | null;
      seconds: number | null;
      preview: string | null;
      full: string | null;
      locked: boolean | null;
      priceCents: number | null;
      paid: boolean | null;
      opened: boolean | null;
    }> | null;
  }>;
  meta: Array<{
    creatorId: string;
    syncedAt: string | null;
    status: "idle" | "ok" | "error";
    reason: string | null;
  }>;
  pending: Array<{
    id: string;
    creatorId: string;
    threadKey: string | null;
    body: string;
  }>;
};

export const listCreatorReads = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<CreatorReadList> => {
    const { listCreatorReadViews } = await import("./of-sessions-runtime.server");
    return listCreatorReadViews(context.userId);
  });

export const setSyncInterval = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { minutes: number; chatMinutes?: number }) => input)
  .handler(async ({ context, data }): Promise<{ intervalMin: number; chatIntervalMin: number }> => {
    const { setSyncIntervalView } = await import("./of-sessions-runtime.server");
    return setSyncIntervalView(context.userId, data.minutes, data.chatMinutes);
  });

export const listCreatorChats = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<CreatorChatList> => {
    const { listCreatorChatViews } = await import("./of-sessions-runtime.server");
    return listCreatorChatViews(context.userId);
  });

export const syncCreatorChats = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { creatorId: string }) => input)
  .handler(async ({ context, data }): Promise<void> => {
    const { syncCreatorChatView } = await import("./of-sessions-runtime.server");
    await syncCreatorChatView(context.userId, data.creatorId);
  });

export type TeamMetricView = {
  userId: string;
  name: string;
  grossCents: number | null;
  ppvSent: number | null;
  ppvBought: number | null;
  firstReplyMinutes: number | null;
  threads: number | null;
};

export type DashboardView = {
  role: "owner" | "member";
  dayGrossCents: number | null;
  monthGrossCents: number | null;
  activeFans: number | null;
  alerts: Array<{ kind: "session" | "sync" | "whale" | "drop"; text: string }>;
};

export const setCreatorProxy = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { creatorId: string; proxy: { server: string; username?: string; password?: string } | null }) => input)
  .handler(async ({ context, data }): Promise<CreatorSessionView> => {
    const { setCreatorProxy: save } = await import("./of-sessions-runtime.server");
    return save(context.userId, data.creatorId, data.proxy);
  });

export const listDashboard = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<DashboardView> => {
    const { listDashboardView } = await import("./of-sessions-runtime.server");
    return listDashboardView(context.userId);
  });

export const recordChatOutbound = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { creatorId: string; fanKey: string | null; threadKey: string | null; body: string; priceCents: number | null; ofMessageKey: string | null }) => input)
  .handler(async ({ context, data }) => {
    const { recordChatOutboundView } = await import("./of-sessions-runtime.server");
    return recordChatOutboundView(context.userId, data);
  });

export const listTeamMetrics = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<TeamMetricView[]> => {
    const { listTeamMetricViews } = await import("./of-sessions-runtime.server");
    return listTeamMetricViews(context.userId);
  });

export const syncCreatorRead = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { creatorId: string }) => input)
  .handler(async ({ context, data }): Promise<CreatorReadView> => {
    const { syncCreatorReadView } = await import("./of-sessions-runtime.server");
    return syncCreatorReadView(context.userId, data.creatorId);
  });

export const checkCreatorSession = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { creatorId: string }) => input)
  .handler(async ({ context, data }): Promise<CreatorSessionView> => {
    const { inspectCreatorSession } = await import("./of-sessions-runtime.server");
    return inspectCreatorSession(context.userId, data.creatorId);
  });
