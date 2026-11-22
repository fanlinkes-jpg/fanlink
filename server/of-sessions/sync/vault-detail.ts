import { isClientAbort } from "../http/vault-http.ts";
import { fetchSignedMediaDetail, sessionForApi } from "./of-chat-api.ts";
import type { StorageStateFile } from "../sessions/storage-state.ts";
import { choosePlayableVideo, drmPlaybackChoice, resolveDetailPlayback, vaultDetailRow, vaultFolderMark, videoContainer, videoFlagLine, videoFormatHold, videoHoldPayload } from "./vault-model.ts";
import { describePlaylist, drmLicenseEnabled, openDrmManifest, protectedVideoHold, readBoundedPlaylist } from "./vault-hls.ts";
import { signedUrlExpired } from "./vault-thumbs.ts";
import { VIDEO_DETAIL_PAUSE_MS } from "./vault-store.ts";

export async function loadMediaDetail(creatorId: string, mediaId: string, origin: string, deps: {
  listAccounts: () => Promise<Array<{ id: string; creatorId: string | null; status: string; hasStorageState: boolean }>>;
  readStorageState: (accountId: string) => Promise<StorageStateFile>;
  fetchImpl: typeof fetch;
}): Promise<{ url: string | null; hold: string; hls: string | null }> {
  const fetchImpl = deps.fetchImpl;
  const account = (await deps.listAccounts()).find((item) => item.creatorId === creatorId && item.status === "active" && item.hasStorageState);
  if (!account) return { url: null, hold: "Vídeo no disponible", hls: null };
  const state = await deps.readStorageState(account.id);
  const auth = sessionForApi(state, Date.now());
  const read = await fetchSignedMediaDetail(state, {
    fetch: fetchImpl,
    now: () => Date.now(),
    accountId: account.id,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  }, mediaId);
  const row = vaultDetailRow(read.body);
  const flags = row ? videoFlagLine(row) : "convertedToVideo=ausente canView=ausente hasError=ausente isReady=ausente";
  const choice = row && !choosePlayableVideo(row) ? drmPlaybackChoice(row) : null;
  if (row && choice && !drmLicenseEnabled()) {
    console.info(`[fanlink:vault] video medio=${vaultFolderMark(mediaId)} detalle=protegido lista=${choice.kind} status=${read.status ?? "sin"} ${flags}`.slice(0, 360));
    return { url: null, hold: protectedVideoHold(), hls: null };
  }
  if (row && choice) {
    const scope = { creatorId, mediaId, sessionCookie: "cookie" in auth ? auth.cookie : "", origin };
    console.info(`[fanlink:vault] video medio=${vaultFolderMark(mediaId)} detalle=pidiendo lista=${choice.kind} status=${read.status ?? "sin"} ${flags}`.slice(0, 360));
    let text: string | null = null;
    try {
      text = await openDrmManifest(row, fetchImpl, () => new Promise((resolve) => setTimeout(resolve, VIDEO_DETAIL_PAUSE_MS)), scope);
    } catch (error) {
      if (isClientAbort(error)) {
        console.info(`[fanlink:vault] video medio=${vaultFolderMark(mediaId)} detalle=abort lista=${choice.kind} status=${read.status ?? "sin"}`.slice(0, 360));
        return { url: null, hold: "", hls: null };
      }
      throw error;
    }
    const shape = text ? describePlaylist(text) : "";
    console.info(`[fanlink:vault] video medio=${vaultFolderMark(mediaId)} detalle=${text ? choice.kind : "sin-url"} ${shape} tipo=lista status=${read.status ?? "sin"} ${flags}`.slice(0, 360));
    if (text) return { url: null, hold: "", hls: text };
    return { url: null, hold: JSON.stringify(videoHoldPayload(read.status, row)), hls: null };
  }
  const playback = row
    ? await resolveDetailPlayback(row, (url) => readBoundedPlaylist(url, fetchImpl), () => new Promise((resolve) => setTimeout(resolve, VIDEO_DETAIL_PAUSE_MS)))
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
