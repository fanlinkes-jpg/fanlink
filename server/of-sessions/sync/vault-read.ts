import type { SessionManager } from "../sessions/session-manager.ts";
import type { StorageStateFile } from "../sessions/storage-state.ts";
import { noteAccountBlock } from "./backoff.ts";
import { fetchSignedVault, type SignedVaultRead } from "./of-chat-api.ts";
import { SESSION_EXPIRED_LABEL } from "./session-link.ts";
import type { ReadSql } from "./store.ts";
import { openProfileThumbs } from "./vault-owner.ts";
import { persistVaultRead } from "./vault-store.ts";
import { rememberVaultThumbs, type ThumbBrowser } from "./vault-thumbs.ts";

export type VaultReadSessions = Pick<SessionManager, "listAccounts" | "readStorageState" | "borrowProfile"> & {
  sessionGeneration?: (accountId: string) => number;
  noteRouteRejection?: (accountId: string, reason: string | null, readEpoch?: number) => Promise<boolean>;
};

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
  const epoch = deps.sessions.sessionGeneration?.(account.id);
  const read = await fetchSignedVault(state, { fetch: deps.fetch, now }, list, offset);
  console.info(`[fanlink:vault] creator=${input.creatorId} status=${read.status ?? "sin"}`);
  const blocked = vaultAuthReason(read);
  if (blocked) {
    if (read.sessionRejected) await deps.sessions.noteRouteRejection?.(account.id, read.reason, epoch)?.catch(() => undefined);
    if (read.signatureRejected) noteAccountBlock(account.id, "400");
    if (read.retryAfterMs > 0) noteAccountBlock(account.id, "429");
    return { items: [], reason: blocked };
  }
  const saved = await persistVaultRead(deps.sql, input.creatorId, read.payloads, { listId: list, offset });
  console.info(`[fanlink:vault] api medios=${saved.length} fotos=${saved.filter((item) => item.preview).length}`);
  if (saved.length === 0) return { items: [], reason: read.reason ?? "No se ha podido leer la bóveda." };
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
      if (again.sessionRejected || again.signatureRejected || again.retryAfterMs > 0) return saved;
      const next = await persistVaultRead(deps.sql, creatorId, again.payloads, { listId: list, offset });
      return next.length > 0 ? next : saved;
    },
    openBrowser: deps.openBrowser ?? (() => openProfileThumbs(deps.sessions, accountId)),
  });
}

function vaultAuthReason(read: SignedVaultRead): string | null {
  if (read.sessionRejected) return SESSION_EXPIRED_LABEL;
  if (read.signatureRejected) return "OnlyFans ha rechazado la firma";
  if (read.retryAfterMs > 0) return "OnlyFans respondió 429";
  return null;
}
