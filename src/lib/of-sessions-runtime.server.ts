import path from "node:path";
import { getSql } from "@/lib/db";
import { beginCreatorLogin } from "../../server/of-sessions/connect.ts";
import { loadCrmSessionConfig } from "../../server/of-sessions/config.ts";
import { onlyFansSite } from "../../server/of-sessions/sessions/onlyfans.ts";
import { createPlaywrightFactory } from "../../server/of-sessions/sessions/browser-factory.ts";
import type { SessionManager } from "../../server/of-sessions/sessions/session-manager.ts";
import { createSessionRuntime } from "../../server/of-sessions/runtime.ts";
import { AccountStore } from "../../server/of-sessions/store/account-store.ts";
import { DbAccountStore } from "../../server/of-sessions/store/db-account-store.ts";
import { createMirroringStore } from "../../server/of-sessions/store/mirroring-store.ts";
import type { Account } from "../../server/of-sessions/types.ts";
import type { CreatorSessionView } from "./of-sessions.ts";

const globalRef = globalThis as typeof globalThis & {
  __ofSessionManager__?: Promise<SessionManager>;
};

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
  return runtime.sessions;
}

export async function listCreatorSessionViews(): Promise<CreatorSessionView[]> {
  const sessions = await getOfSessionManager();
  const accounts = await sessions.listAccounts();
  return accounts.flatMap((account) => {
    const view = toView(account);
    return view ? [view] : [];
  });
}

export async function connectCreator(
  input: unknown,
): Promise<CreatorSessionView> {
  const sessions = await getOfSessionManager();
  const account = await beginCreatorLogin(sessions, input);
  const view = toView(account);
  if (!view) throw new Error("La sesión no está ligada a una creadora");
  return view;
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
    lastCheckedAt: account.lastCheckedAt,
    lastError: account.lastError,
  };
}
