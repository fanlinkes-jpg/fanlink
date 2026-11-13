import type { SessionManager } from "../sessions/session-manager.ts";
import type { StorageStateFile } from "../sessions/storage-state.ts";
import { fetchSignedVault } from "./of-chat-api.ts";
import type { ReadSql } from "./store.ts";
import { openProfileThumbs } from "./vault-owner.ts";
import { persistVaultRead } from "./vault-store.ts";
import { rememberVaultThumbs, type ThumbBrowser } from "./vault-thumbs.ts";

export type VaultReadSessions = Pick<SessionManager, "listAccounts" | "readStorageState" | "borrowProfile">;

export type VaultReadDeps = {
  fetch: typeof fetch;
  now?: () => number;
  sql: ReadSql;
  sessions: VaultReadSessions;
  access: { role: "owner" | "member"; perms: readonly string[] };
  openBrowser?: () => Promise<ThumbBrowser | null>;
};

/** Medios de una página y sus miniaturas. No abre un segundo Chromium. */
export async function readChatVaultView(
  input: { creatorId: string; threadKey?: string; listId?: string; offset?: number },
  deps: VaultReadDeps,
): Promise<{ items: Array<{ id: string; title: string; kind: "foto" | "video" | "audio" | null }>; reason: string | null }> {
  if (deps.access.role !== "owner" && !deps.access.perms.includes("mensajes")) {
    throw new Error("No tienes permiso para escribir.");
  }
  const account = (await deps.sessions.listAccounts()).find((item) => item.creatorId === input.creatorId);
  if (!account || !account.hasStorageState) return { items: [], reason: "Sin datos" };
  const state = await deps.sessions.readStorageState(account.id);
  const list = input.listId || "all";
  const offset = input.offset ?? 0;
  const now = deps.now ?? (() => Date.now());
  const payloads = await fetchSignedVault(state, { fetch: deps.fetch, now }, list, offset);
  const saved = await persistVaultRead(deps.sql, input.creatorId, payloads, { listId: list, offset });
  console.info(`[fanlink:vault] api medios=${saved.length} fotos=${saved.filter((item) => item.preview).length}`);
  if (saved.length === 0) return { items: [], reason: "No se ha podido leer la bóveda." };
  await rememberPageThumbs({ ...deps, now }, account.id, input.creatorId, saved, state, list, offset);
  return {
    items: saved.map((item) => ({ id: item.id, title: item.title, kind: item.kind })),
    reason: null,
  };
}

async function rememberPageThumbs(
  deps: VaultReadDeps & { now: () => number },
  accountId: string,
  creatorId: string,
  saved: ReadonlyArray<{ id: string; preview: string | null }>,
  state: StorageStateFile,
  list: string,
  offset: number,
): Promise<void> {
  await rememberVaultThumbs({
    creatorId,
    items: saved,
    state,
    fetch: deps.fetch,
    now: deps.now(),
    refreshPage: async () => {
      const again = await fetchSignedVault(state, { fetch: deps.fetch, now: deps.now }, list, offset);
      const next = await persistVaultRead(deps.sql, creatorId, again, { listId: list, offset });
      return next.length > 0 ? next : saved;
    },
    openBrowser: deps.openBrowser ?? (() => openProfileThumbs(deps.sessions, accountId)),
  });
}
