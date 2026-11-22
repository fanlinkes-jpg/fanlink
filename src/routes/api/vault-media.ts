import { createFileRoute } from "@tanstack/react-router";
import { authConfigured, DEV_USER_ID, requireUserId, UnauthorizedError } from "@/lib/auth/verify.server";
import { getSql } from "@/lib/db";
import { getOfSessionManager } from "@/lib/of-sessions-runtime.server";
import { ensureStaff } from "@/lib/workspace-store";
import { abortResponse, handleVaultMedia, noteVaultPlayRequest } from "../../../server/of-sessions/http/vault-http.ts";
import { creatorAllowed } from "../../../server/of-sessions/sync/vault-query.ts";
import { readSessionMediaResult, videoBytesAccepted, videoFollowUp } from "../../../server/of-sessions/sync/media-bytes.ts";
import { accountCreatorIds } from "../../../server/of-sessions/http/vault-accounts.ts";
import { fetchSignedMediaDetail, fetchSignedVault, sessionForApi } from "../../../server/of-sessions/sync/of-chat-api.ts";
import { choosePlayableVideo, drmManifestUrl, parseVaultBundle, resolveDetailPlayback, vaultDetailRow, vaultFolderMark, videoContainer, videoFlagLine, videoFormatHold, videoHoldPayload } from "../../../server/of-sessions/sync/vault-model.ts";
import { forwardDrmLicense, hlsMediaResponse, openHlsManifest, readBoundedPlaylist } from "../../../server/of-sessions/sync/vault-hls.ts";
import { loadFreshPreview, normalizeVaultOffset, reloadVaultPreview, signedUrlExpired } from "../../../server/of-sessions/sync/vault-thumbs.ts";
import { openProfileThumbs } from "../../../server/of-sessions/sync/vault-owner.ts";
import { playbackUrl, reuseOrRefreshVideo, saveVaultPreview, storedVaultMediaUrls, storedVaultPage, VIDEO_DETAIL_PAUSE_MS } from "../../../server/of-sessions/sync/vault-store.ts";

export const Route = createFileRoute("/api/vault-media")({
  server: {
    handlers: {
      GET: async ({ request }) => vaultMediaGet(request),
      POST: async ({ request }) => {
        try {
          const url = new URL(request.url);
          if (url.searchParams.get("variant") !== "licencia") return new Response("Sin datos", { status: 404 });
          const access = await vaultAccess();
          const creatorId = url.searchParams.get("creatorId") ?? "";
          if (!creatorAllowed({ userId: access.userId, role: access.role, perms: access.perms, creatorIds: access.creatorIds }, creatorId)) {
            return new Response("Sin datos", { status: 403 });
          }
          return forwardDrmLicense({
            creatorId,
            mediaId: url.searchParams.get("mediaId") ?? "",
            ticket: url.searchParams.get("k") ?? "",
            segment: url.searchParams.get("s") ?? "",
            body: new Uint8Array(await request.arrayBuffer()),
            contentType: request.headers.get("content-type") ?? "application/octet-stream",
            signal: request.signal,
          }, fetch);
        } catch (error) {
          const aborted = abortResponse(error);
          if (aborted) return aborted;
          if (error instanceof UnauthorizedError) return new Response("Unauthorized", { status: 401 });
          throw error;
        }
      },
    },
  },
});

async function vaultAccess() {
  const userId = await requireUserId();
  const sql = await getSql();
  const access = await ensureStaff(sql, userId, !authConfigured && userId === DEV_USER_ID);
  const creatorIds = await accountCreatorIds(sql);
  return { sql, userId: access.userId, role: access.role, perms: access.perms, creatorIds };
}

async function vaultMediaGet(request: Request): Promise<Response> {
  noteVaultPlayRequest(request);
  try {
    const access = await vaultAccess();
    const sql = access.sql;
    const url = new URL(request.url);
    const rawEarly = url.searchParams.get("variant");
    if (rawEarly === "hls" || rawEarly === "licencia") {
      const creatorId = url.searchParams.get("creatorId") ?? "";
      if (!creatorAllowed({ userId: access.userId, role: access.role, perms: access.perms, creatorIds: access.creatorIds }, creatorId)) {
        return new Response("Sin datos", { status: 403 });
      }
      return hlsMediaResponse({
        creatorId,
        mediaId: url.searchParams.get("mediaId") ?? "",
        ticket: url.searchParams.get("k") ?? "",
        segment: url.searchParams.get("s") ?? "",
        range: request.headers.get("range"),
        signal: request.signal,
      }, fetch);
    }
    const creatorId = url.searchParams.get("creatorId") ?? "";
    const mediaId = url.searchParams.get("mediaId") ?? "";
          const rawVariant = url.searchParams.get("variant");
          const variant = rawVariant === "full" || rawVariant === "clip" ? rawVariant : "preview";
          const page = await thumbPage(sql, creatorId, mediaId, url);
          let expectVideo = false;
          let hold: string | null = null;
          let hlsManifest: string | null = null;
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
            if (again.hls) {
              hlsManifest = again.hls;
              rememberHls(creatorId, mediaId, again.hls);
            }
            if (!again.url && again.hold) {
              hold = again.hold;
              rememberHold(creatorId, mediaId, again.hold);
            }
            return again.url;
          };
          return handleVaultMedia(request, {
            session: async () => ({ userId: access.userId, role: access.role, perms: access.perms, creatorIds: access.creatorIds }),
            videoHold: () => hold,
            findPreview: async (creator, id, wanted) => {
              const urls = await storedVaultMediaUrls(sql, creator, id);
              const play = wanted === "clip" ? "clip" : wanted === "full" ? "full" : "preview";
              expectVideo = urls.kind === "video" && (play === "full" || play === "clip");
              const picked = playbackUrl(urls, play, urls.kind);
              if (!expectVideo) return picked;
              if (picked && !signedUrlExpired(picked, Date.now())) return picked;
              const cachedHls = rememberedHls(creator, id);
              if (cachedHls) {
                hlsManifest = cachedHls;
                return "https://cdn2.onlyfans.com/hls/media.m3u8";
              }
              const remembered = !picked ? rememberedHold(creator, id) : null;
              if (remembered) {
                hold = remembered;
                return null;
              }
              const fresh = await refreshOnce(Boolean(picked));
              if (hlsManifest) return "https://cdn2.onlyfans.com/hls/media.m3u8";
              return fresh;
            },
            fetchBytes: async (target, range, signal) => {
              if (hlsManifest) {
                return { status: 200, body: new TextEncoder().encode(hlsManifest), contentType: "application/vnd.apple.mpegurl" };
              }
              if (expectVideo && videoContainer({ url: target }) === "avi") {
                hold = aviHold();
                rememberHold(creatorId, mediaId, hold);
                return null;
              }
              if (expectVideo || range) {
                const first = await readSessionMediaResult(creatorId, target, range, { expectVideo, signal });
                if (first.status === 415) {
                  hold = aviHold();
                  rememberHold(creatorId, mediaId, hold);
                  return null;
                }
                if (first.media && (!expectVideo || videoBytesAccepted(first.media.contentType))) return first.media;
                const plan = videoFollowUp(first.status, first.media?.contentType ?? null, expectVideo);
                if (expectVideo && plan === "refresh") {
                  const fresh = await refreshOnce(true);
                  if (!fresh) return null;
                  const second = await readSessionMediaResult(creatorId, fresh, range, { expectVideo, signal });
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
    const aborted = abortResponse(error);
    if (aborted) return aborted;
    if (error instanceof UnauthorizedError) return new Response("Unauthorized", { status: 401 });
    throw error;
  }
}

const videoHolds = new Map<string, { at: number; text: string }>();
const hlsManifests = new Map<string, { at: number; text: string }>();

function rememberedHls(creatorId: string, mediaId: string): string | null {
  const hit = hlsManifests.get(`${creatorId}\n${mediaId}`);
  if (!hit || Date.now() - hit.at > 9 * 60_000) return null;
  return hit.text;
}

function rememberHls(creatorId: string, mediaId: string, text: string): void {
  hlsManifests.set(`${creatorId}\n${mediaId}`, { at: Date.now(), text });
}

function rememberedHold(creatorId: string, mediaId: string): string | null {
  const hit = videoHolds.get(`${creatorId}\n${mediaId}`);
  if (!hit || Date.now() - hit.at > 60_000) return null;
  return hit.text;
}

function rememberHold(creatorId: string, mediaId: string, text: string): void {
  videoHolds.set(`${creatorId}\n${mediaId}`, { at: Date.now(), text });
}

async function loadMediaDetail(creatorId: string, mediaId: string): Promise<{ url: string | null; hold: string; hls: string | null }> {
  const sessions = await getOfSessionManager();
  const account = (await sessions.listAccounts()).find((item) => item.creatorId === creatorId && item.status === "active" && item.hasStorageState);
  if (!account) return { url: null, hold: "Vídeo no disponible", hls: null };
  const state = await sessions.readStorageState(account.id);
  const auth = sessionForApi(state, Date.now());
  const read = await fetchSignedMediaDetail(state, {
    fetch,
    now: () => Date.now(),
    accountId: account.id,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  }, mediaId);
  const row = vaultDetailRow(read.body);
  const flags = row ? videoFlagLine(row) : "convertedToVideo=ausente canView=ausente hasError=ausente isReady=ausente";
  const manifest = row && !choosePlayableVideo(row) ? drmManifestUrl(row) : null;
  if (row && manifest && /\.m3u8(?:$|\?)/i.test(manifest)) {
    const text = await openHlsManifest(row, fetch, () => new Promise((resolve) => setTimeout(resolve, VIDEO_DETAIL_PAUSE_MS)), {
      creatorId,
      mediaId,
      sessionCookie: "cookie" in auth ? auth.cookie : "",
    });
    console.info(`[fanlink:vault] video medio=${vaultFolderMark(mediaId)} detalle=${text ? "hls" : "sin-url"} tipo=lista status=${read.status ?? "sin"} ${flags}`.slice(0, 360));
    if (text) return { url: null, hold: "", hls: text };
    return { url: null, hold: JSON.stringify(videoHoldPayload(read.status, row)), hls: null };
  }
  const playback = row
    ? await resolveDetailPlayback(row, readPlaylist, () => new Promise((resolve) => setTimeout(resolve, VIDEO_DETAIL_PAUSE_MS)))
    : { url: null, via: "sin-url" as const };
  const tipo = videoContainer({ url: playback.url });
  console.info(`[fanlink:vault] video medio=${vaultFolderMark(mediaId)} detalle=${playback.via} tipo=${tipo} status=${read.status ?? "sin"} ${flags}`.slice(0, 360));
  const format = videoFormatHold(tipo);
  if (format) return { url: null, hold: aviHold(), hls: null };
  if (playback.url && !signedUrlExpired(playback.url, Date.now())) return { url: playback.url, hold: "", hls: null };
  return { url: null, hold: JSON.stringify(videoHoldPayload(read.status, row)), hls: null };
}

function aviHold(): string {
  return JSON.stringify(videoFormatHold("avi") ?? { texto: "Este vídeo es AVI y el navegador no puede reproducirlo.", abrir: true });
}

async function readPlaylist(url: string): Promise<string | null> {
  return readBoundedPlaylist(url, fetch);
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
