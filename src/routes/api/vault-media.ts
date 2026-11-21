import { createFileRoute } from "@tanstack/react-router";
import { authConfigured, DEV_USER_ID, requireUserId, UnauthorizedError } from "@/lib/auth/verify.server";
import { getSql } from "@/lib/db";
import { getOfSessionManager } from "@/lib/of-sessions-runtime.server";
import { ensureStaff } from "@/lib/workspace-store";
import { handleVaultMedia, noteVaultPlayRequest } from "../../../server/of-sessions/http/vault-http.ts";
import { readSessionMediaResult, videoBytesAccepted, videoFollowUp } from "../../../server/of-sessions/sync/media-bytes.ts";
import { accountCreatorIds } from "../../../server/of-sessions/http/vault-accounts.ts";
import { fetchSignedMediaDetail, fetchSignedVault } from "../../../server/of-sessions/sync/of-chat-api.ts";
import { parseVaultBundle, resolveDetailPlayback, vaultDetailRow, vaultFolderMark, videoFlagLine, videoHoldPayload } from "../../../server/of-sessions/sync/vault-model.ts";
import { loadFreshPreview, normalizeVaultOffset, reloadVaultPreview, signedUrlExpired } from "../../../server/of-sessions/sync/vault-thumbs.ts";
import { openProfileThumbs } from "../../../server/of-sessions/sync/vault-owner.ts";
import { playbackUrl, reuseOrRefreshVideo, saveVaultPreview, storedVaultMediaUrls, storedVaultPage, VIDEO_DETAIL_PAUSE_MS } from "../../../server/of-sessions/sync/vault-store.ts";

export const Route = createFileRoute("/api/vault-media")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        noteVaultPlayRequest(request);
        try {
          const userId = await requireUserId();
          const sql = await getSql();
          const access = await ensureStaff(sql, userId, !authConfigured && userId === DEV_USER_ID);
          const creatorIds = await accountCreatorIds(sql);
          const url = new URL(request.url);
          const creatorId = url.searchParams.get("creatorId") ?? "";
          const mediaId = url.searchParams.get("mediaId") ?? "";
          const rawVariant = url.searchParams.get("variant");
          const variant = rawVariant === "full" || rawVariant === "clip" ? rawVariant : "preview";
          const page = await thumbPage(sql, creatorId, mediaId, url);
          let expectVideo = false;
          let hold: string | null = null;
          let refreshed = false;
          const wantedVariant = variant === "clip" ? "clip" : "full";
          const refreshOnce = async (pause: boolean): Promise<string | null> => {
            if (refreshed) return null;
            refreshed = true;
            const again = await reuseOrRefreshVideo({
              sql,
              creatorId,
              mediaId,
              variant: wantedVariant,
              now: Date.now(),
              force: pause,
              pause: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
              loadDetail: () => loadMediaDetail(creatorId, mediaId),
            });
            if (!again.url && again.hold) {
              hold = again.hold;
              rememberHold(creatorId, mediaId, again.hold);
            }
            return again.url;
          };
          return handleVaultMedia(request, {
            session: async () => ({ userId: access.userId, role: access.role, perms: access.perms, creatorIds }),
            videoHold: () => hold,
            findPreview: async (creator, id, wanted) => {
              const urls = await storedVaultMediaUrls(sql, creator, id);
              const play = wanted === "clip" ? "clip" : wanted === "full" ? "full" : "preview";
              expectVideo = urls.kind === "video" && (play === "full" || play === "clip");
              const picked = playbackUrl(urls, play, urls.kind);
              if (!expectVideo) return picked;
              if (picked && !signedUrlExpired(picked, Date.now())) return picked;
              const remembered = !picked ? rememberedHold(creator, id) : null;
              if (remembered) {
                hold = remembered;
                return null;
              }
              return refreshOnce(Boolean(picked));
            },
            fetchBytes: async (target, range) => {
              if (expectVideo || range) {
                const first = await readSessionMediaResult(creatorId, target, range, { expectVideo });
                if (first.media && (!expectVideo || videoBytesAccepted(first.media.contentType))) return first.media;
                const plan = videoFollowUp(first.status, first.media?.contentType ?? null, expectVideo);
                if (expectVideo && plan === "refresh") {
                  const fresh = await refreshOnce(true);
                  if (!fresh) return null;
                  const second = await readSessionMediaResult(creatorId, fresh, range, { expectVideo });
                  if (!second.media || !videoBytesAccepted(second.media.contentType)) return null;
                  return second.media;
                }
                if (plan !== "refresh") return null;
                const fresh = await reloadPreview(sql, creatorId, mediaId, page.listId, page.offset);
                if (!fresh) return null;
                return (await readSessionMediaResult(creatorId, fresh, range)).media;
              }
              return loadFreshPreview({
                creatorId,
                mediaId,
                url: target,
                read: (next) => readSessionMediaResult(creatorId, next),
                reload: () => reloadPreview(sql, creatorId, mediaId, page.listId, page.offset),
                openBrowser: () => profileThumbs(creatorId),
              });
            },
            log: (line) => {
              console.info(line);
            },
          });
        } catch (error) {
          if (error instanceof UnauthorizedError) return new Response("Unauthorized", { status: 401 });
          throw error;
        }
      },
    },
  },
});

const videoHolds = new Map<string, { at: number; text: string }>();

function rememberedHold(creatorId: string, mediaId: string): string | null {
  const hit = videoHolds.get(`${creatorId}\n${mediaId}`);
  if (!hit || Date.now() - hit.at > 60_000) return null;
  return hit.text;
}

function rememberHold(creatorId: string, mediaId: string, text: string): void {
  videoHolds.set(`${creatorId}\n${mediaId}`, { at: Date.now(), text });
}

async function loadMediaDetail(creatorId: string, mediaId: string): Promise<{ url: string | null; hold: string }> {
  const sessions = await getOfSessionManager();
  const account = (await sessions.listAccounts()).find((item) => item.creatorId === creatorId && item.status === "active" && item.hasStorageState);
  if (!account) return { url: null, hold: "Vídeo no disponible" };
  const read = await fetchSignedMediaDetail(await sessions.readStorageState(account.id), {
    fetch,
    now: () => Date.now(),
    accountId: account.id,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  }, mediaId);
  const row = vaultDetailRow(read.body);
  const flags = row ? videoFlagLine(row) : "convertedToVideo=ausente canView=ausente hasError=ausente isReady=ausente";
  const playback = row
    ? await resolveDetailPlayback(row, readPlaylist, () => new Promise((resolve) => setTimeout(resolve, VIDEO_DETAIL_PAUSE_MS)))
    : { url: null, via: "sin-url" as const };
  console.info(`[fanlink:vault] video medio=${vaultFolderMark(mediaId)} detalle=${playback.via} status=${read.status ?? "sin"} ${flags}`.slice(0, 320));
  if (playback.url && !signedUrlExpired(playback.url, Date.now())) return { url: playback.url, hold: "" };
  return { url: null, hold: JSON.stringify(videoHoldPayload(read.status, row)) };
}

async function readPlaylist(url: string): Promise<string | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  }
}

async function thumbPage(
  sql: Awaited<ReturnType<typeof getSql>>,
  creatorId: string,
  mediaId: string,
  url: URL,
): Promise<{ listId: string; offset: number }> {
  const requestedList = url.searchParams.get("list");
  const requestedOffset = url.searchParams.get("offset");
  if (requestedList != null || requestedOffset != null) {
    return {
      listId: requestedList?.trim() || "all",
      offset: normalizeVaultOffset(Number(requestedOffset ?? "0")),
    };
  }
  const stored = await storedVaultPage(sql, creatorId, mediaId);
  return stored ?? { listId: "all", offset: 0 };
}

async function reloadPreview(
  sql: Awaited<ReturnType<typeof getSql>>,
  creatorId: string,
  mediaId: string,
  listId: string,
  offset: number,
  pick: "preview" | "full" = "preview",
): Promise<string | null> {
  return reloadVaultPreview({
    creatorId,
    mediaId,
    listId,
    offset,
    pick,
    loadPage: async (list, skip) => {
      const sessions = await getOfSessionManager();
      const account = (await sessions.listAccounts()).find((item) => item.creatorId === creatorId && item.status === "active" && item.hasStorageState);
      if (!account) return [];
      const read = await fetchSignedVault(await sessions.readStorageState(account.id), {
        fetch,
        now: () => Date.now(),
        accountId: account.id,
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      }, list, skip, { includeLists: false });
      if (read.sessionRejected || read.signatureRejected || read.retryAfterMs > 0) return [];
      return read.payloads.flatMap((payload) => parseVaultBundle(payload).items);
    },
    savePreview: (preview) => saveVaultPreview(sql, creatorId, mediaId, preview, { listId, offset }),
  });
}

async function profileThumbs(creatorId: string) {
  const sessions = await getOfSessionManager();
  const account = (await sessions.listAccounts()).find((item) => item.creatorId === creatorId && item.status === "active" && item.hasStorageState);
  if (!account) return null;
  return openProfileThumbs(sessions, account.id);
}
