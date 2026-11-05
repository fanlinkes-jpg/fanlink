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
  connection: "not_checked" | "live" | "rejected" | "inconclusive";
  identityState: "unavailable" | "verified" | "mismatch";
  identityLabel: string | null;
  identityHandle: string | null;
  identityName: string | null;
  identityUserId: string | null;
  identityCheckedAt: string | null;
  readsBlocked: boolean;
  lastCheckedAt: string | null;
  lastError: string | null;
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

export const checkCreatorSession = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { creatorId: string }) => input)
  .handler(async ({ context, data }): Promise<CreatorSessionView> => {
    const { inspectCreatorSession } = await import("./of-sessions-runtime.server");
    return inspectCreatorSession(context.userId, data.creatorId);
  });
