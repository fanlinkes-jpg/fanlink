import { textSaleBlocked } from "./vault-block.ts";
import { liveViewDebug } from "../live/debug.ts";
import { mediaHostAllowed } from "./history.ts";

export type VaultKind = "foto" | "video" | "audio" | "gif" | null;

export type VaultFile = {
  id: string;
  title: string | null;
  kind: VaultKind;
  seconds: number | null;
  preview: string | null;
  folder: string | null;
  tags: string[];
  listId: string | null;
  listName: string | null;
  description: string | null;
  uploadedAt: string | null;
  priceCents: number | null;
  salesCount: number | null;
  sentCount: number | null;
  /** URL del archivo, no de la miniatura. No sale en el JSON del chatter. */
  fullUrl?: string | null;
  /** `files.thumb`, si viene aparte del preview. No sale en el JSON del chatter. */
  thumbUrl?: string | null;
  /** Rendición corta de `videoSources`, o preview si es un vídeo. No sale en el JSON del chatter. */
  clipUrl?: string | null;
  /** Id del vídeo de pago, si el tráiler lo dice. Sin esto no se empareja. */
  paidWithId?: string | null;
  /** Todas las listas del medio. `listId` es la principal. */
  listIds?: string[];
};

export type VaultList = {
  id: string;
  name: string;
  photos?: number | null;
  videos?: number | null;
  gifs?: number | null;
  audios?: number | null;
  hasMedia?: boolean | null;
  /** `count` suelto, si no hay desglose. */
  count?: number | null;
  /** Portadas de `medias` de esa lista. Sin URL. */
  covers?: Array<{ id: string; kind: VaultKind }>;
  /** `custom` o el tipo de sistema. No se guarda. */
  type?: string;
  /** Claves del JSON, solo para el log. No se guardan. */
  sourceKeys?: string;
};

export function vaultKindOf(value: string | null | undefined): VaultKind {
  if (value === "foto" || value === "video" || value === "audio" || value === "gif") return value;
  return null;
}

export type FanVaultUse = {
  itemKey: string;
  fanKey: string;
  sentAt: string | null;
  priceCents: number | null;
  purchased: boolean | null;
  authorId: string | null;
};

/** Una página del vault y luego una pausa. No se barre entero de golpe. */
export function vaultSyncGap(lastAt: number | null, now: number, gapMs = 12_000): number {
  if (lastAt == null) return 0;
  return Math.max(0, gapMs - (now - lastAt));
}

/** Carpetas que el dueño no quiere vender. También «No-vender» y «SIN EDITAR». */
export function vaultSaleBlocked(folder: string | null, title: string | null): boolean {
  return textSaleBlocked(`${folder ?? ""} ${title ?? ""}`);
}

/**
 * Precio sugerido solo con ventas reales de esa pieza, a cualquier fan (mediana).
 * Sin compras: «Sin datos». No hay banda por defecto ni un precio inventado.
 */
export function suggestVaultPrice(input: {
  seconds: number | null;
  folder: string | null;
  title: string | null;
  purchasesCents?: readonly number[];
}): { cents: number | null; label: string } {
  const purchases = (input.purchasesCents ?? []).filter((cents) => Number.isFinite(cents) && cents > 0);
  if (purchases.length === 0) return { cents: null, label: "Sin datos" };
  const sorted = [...purchases].sort((left, right) => left - right);
  const mid = sorted[Math.floor((sorted.length - 1) / 2)];
  if (mid == null || !Number.isFinite(mid)) return { cents: null, label: "Sin datos" };
  const cents = Math.round(mid);
  const dollars = Math.round(cents / 100);
  return { cents, label: `$${dollars}` };
}

export function parseVaultBundle(payload: unknown): { items: VaultFile[]; lists: VaultList[] } {
  const lists = vaultLists(payload);
  collectFolders(payload, lists);
  const all = vaultAllList(payload);
  if (all && !lists.some((list) => list.id === all.id)) lists.push(all);
  const raw = vaultList(payload);
  const items = raw.filter((entry) => !isFolderRow(entry)).flatMap((item) => parseVaultItem(item, lists));
  return { items, lists };
}

/** `list` de carpetas y `list` de medios comparten la clave. El de carpetas no pagina el otro. */
export function vaultPayloadKind(payload: unknown): "lists" | "media" | "other" {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "other";
  const row = payload as Record<string, unknown>;
  const list = firstNamedArray(row, ["list", "lists", "folders", "medias", "media"]);
  if (!list) return "other";
  if (list.length === 0) {
    const folders = Array.isArray(row.lists) || Array.isArray(row.folders) || "all" in row || "canCreateVaultLists" in row;
    return folders ? "lists" : "media";
  }
  const folders = list.filter((item) => isFolderRow(item)).length;
  if (folders === list.length) return "lists";
  return "media";
}

/** Nombres de claves, nunca valores. Incluye un nivel (`counters.messagesCount`). */
export function vaultKeyNames(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "ninguna";
  const row = value as Record<string, unknown>;
  const own = Object.keys(row).filter(keyName);
  const keys = [...own];
  for (const key of own) {
    const child = row[key];
    if (!child || typeof child !== "object" || Array.isArray(child)) continue;
    for (const inner of Object.keys(child).filter(keyName).slice(0, 8)) keys.push(`${key}.${inner}`);
  }
  const shown = [...new Set(keys)].slice(0, 24);
  return shown.length ? shown.join(",") : "ninguna";
}

function keyName(key: string): boolean {
  return /^[a-z][a-z0-9_]{0,40}$/i.test(key);
}

/** Conteos de "Todos los medios". OF los manda en `all`, aparte del array `list`. */
export function vaultAllList(payload: unknown): VaultList | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const all = (payload as Record<string, unknown>).all;
  if (!all || typeof all !== "object" || Array.isArray(all)) return null;
  const counts = listCounts(all as Record<string, unknown>);
  if (counts.photos == null && counts.videos == null && counts.gifs == null && counts.audios == null) return null;
  return { id: "all", name: "Todos", ...counts, sourceKeys: vaultKeyNames(all) };
}

function isFolderRow(item: unknown): boolean {
  if (!item || typeof item !== "object" || Array.isArray(item)) return false;
  const row = item as Record<string, unknown>;
  if (row.files || row.mediaId || row.src || row.previewUrl) return false;
  const type = (textOf(row.type) ?? "").toLowerCase();
  if (["photo", "image", "video", "audio", "gif", "foto"].some((kind) => type.includes(kind))) return false;
  return Boolean(textOf(row.id) && textOf(row.name ?? row.title));
}

export function parseVaultPayload(payload: unknown): VaultFile[] {
  return parseVaultBundle(payload).items;
}

/** Dólares de OnlyFans (`price: 9.99`) pasan a céntimos. `priceCents` ya viene en céntimos. */
export function priceToCents(row: { priceCents?: unknown; price?: unknown }): number | null {
  if (typeof row.priceCents === "number" && Number.isFinite(row.priceCents) && row.priceCents >= 0) {
    return Math.round(row.priceCents);
  }
  const raw = row.price;
  const dollars = typeof raw === "number"
    ? raw
    : typeof raw === "string" && raw.trim()
      ? Number(raw.replace(/[^0-9.]/g, ""))
      : Number.NaN;
  if (!Number.isFinite(dollars) || dollars < 0) return null;
  return Math.round(dollars * 100);
}

export type TrailerPackage = {
  trailerId: string;
  paidId: string;
  label: "Tráiler gratis + vídeo de pago";
};

function isFreeTrailer(item: VaultFile): boolean {
  const text = `${item.title ?? ""} ${item.tags.join(" ")}`.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  const marked = text.includes("trailer");
  return marked && item.priceCents === 0 && item.kind !== "audio";
}

/** Solo si el tráiler señala el id del vídeo de pago. Un precio desconocido no es gratis. */
export function trailerPackages(items: readonly VaultFile[]): TrailerPackage[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const packs: TrailerPackage[] = [];
  for (const trailer of items) {
    if (!isFreeTrailer(trailer) || !trailer.paidWithId || trailer.paidWithId === trailer.id) continue;
    const paid = byId.get(trailer.paidWithId);
    if (!paid || paid.kind !== "video" || paid.priceCents == null || paid.priceCents <= 0 || isFreeTrailer(paid)) continue;
    packs.push({ trailerId: trailer.id, paidId: paid.id, label: "Tráiler gratis + vídeo de pago" });
  }
  return packs;
}

export function historyFromMedia(rows: ReadonlyArray<{
  fanKey: string | null;
  fromFan: boolean;
  sentAt: string | null;
  priceCents: number | null;
  purchased: boolean | null;
  authorId: string | null;
  mediaJson: string | null;
}>): FanVaultUse[] {
  const uses: FanVaultUse[] = [];
  for (const row of rows) {
    if (row.fromFan || !row.fanKey) continue;
    for (const id of mediaIds(row.mediaJson)) {
      uses.push({
        itemKey: id,
        fanKey: row.fanKey,
        sentAt: row.sentAt,
        priceCents: row.priceCents,
        purchased: row.purchased,
        authorId: row.authorId,
      });
    }
  }
  return uses;
}

export function historyFromSends(rows: ReadonlyArray<{
  fanKey: string | null;
  itemKey: string;
  sentAt: string | null;
  priceCents: number | null;
  purchased: boolean | null;
  authorId: string | null;
}>): FanVaultUse[] {
  return rows.flatMap((row) => {
    if (!row.fanKey || !row.itemKey) return [];
    return [{
      itemKey: row.itemKey,
      fanKey: row.fanKey,
      sentAt: row.sentAt,
      priceCents: row.priceCents,
      purchased: row.purchased,
      authorId: row.authorId,
    }];
  });
}

/** Si el hilo y el CRM hablan de la misma pieza y el mismo chatter, se queda el dato más completo. Otro chatter no se pisa. */
export function mergeFanUses(uses: readonly FanVaultUse[]): FanVaultUse[] {
  const byKey = new Map<string, FanVaultUse>();
  const loose: FanVaultUse[] = [];
  for (const use of uses) {
    if (!use.authorId) {
      loose.push(use);
      continue;
    }
    const key = `${use.fanKey}\n${use.itemKey}\n${use.authorId}`;
    const previous = byKey.get(key);
    byKey.set(key, previous ? richerUse(previous, use) : use);
  }
  for (const use of loose) {
    const matches = [...byKey.values()].filter((row) => row.fanKey === use.fanKey && row.itemKey === use.itemKey && row.authorId);
    if (matches.length === 1 && matches[0]) {
      const only = matches[0];
      byKey.set(`${only.fanKey}\n${only.itemKey}\n${only.authorId}`, richerUse(only, { ...use, authorId: only.authorId }));
      continue;
    }
    const key = `${use.fanKey}\n${use.itemKey}\n`;
    const previous = byKey.get(key);
    byKey.set(key, previous ? richerUse(previous, use) : use);
  }
  return [...byKey.values()];
}

function richerUse(previous: FanVaultUse, use: FanVaultUse): FanVaultUse {
  return {
    itemKey: use.itemKey,
    fanKey: use.fanKey,
    sentAt: later(previous.sentAt, use.sentAt),
    priceCents: use.priceCents ?? previous.priceCents,
    purchased: use.purchased ?? previous.purchased,
    authorId: use.authorId ?? previous.authorId,
  };
}

function later(left: string | null, right: string | null): string | null {
  if (!left) return right;
  if (!right) return left;
  return left > right ? left : right;
}

function mediaIds(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const row = item as Record<string, unknown>;
      const id = textOf(row.id ?? row.mediaId ?? row.vaultId);
      return id ? [id] : [];
    });
  } catch {
    return [];
  }
}

function parseVaultItem(item: unknown, lists: readonly VaultList[]): VaultFile[] {
  if (!item || typeof item !== "object" || Array.isArray(item)) return [];
  const row = item as Record<string, unknown>;
  const id = textOf(row.id ?? row.mediaId);
  if (!id) return [];
  const rawTitle = textOf(row.title ?? row.name ?? row.fileName);
  const title = rawTitle && rawTitle.toLowerCase() !== "sin datos" ? rawTitle.slice(0, 120) : null;
  const type = (textOf(row.type ?? row.kind) ?? "").toLowerCase();
  const gif = type.includes("gif") || row.gif === true || row.isGif === true;
  const kind: VaultKind = type.includes("video")
    ? "video"
    : type.includes("audio")
      ? "audio"
      : gif
        ? "gif"
        : type.includes("photo") || type.includes("image") || type.includes("foto")
          ? "foto"
          : null;
  const seconds = kind === "foto" || kind === "gif" ? null : countOrNull(row.duration ?? row.durationSeconds);
  const membership = listMembership(row, lists);
  const posted = boolFlag(row, ["hasPosts", "isPosted", "posted"]);
  const sent = boolFlag(row, ["hasMessages", "isSent"]);
  return [{
    id,
    title,
    kind,
    seconds,
    preview: previewOf(row),
    thumbUrl: thumbOf(row),
    clipUrl: clipOf(row),
    folder: membership.listName,
    tags: tagsOf(row, posted, sent),
    listId: membership.listId,
    listName: membership.listName,
    listIds: membership.listIds,
    description: textOf(row.description ?? row.caption ?? row.text),
    uploadedAt: textOf(row.uploadedAt ?? row.createdAt),
    priceCents: priceToCents(row),
    salesCount: countOrNull(row.salesCount ?? row.purchases),
    sentCount: sentCountOf(row),
    fullUrl: kind === "video" ? videoFileOf(row) : fullOf(row),
    paidWithId: textOf(row.paidMediaId ?? row.pairedMediaId ?? row.fullMediaId),
  }];
}

function boolFlag(row: Record<string, unknown>, keys: readonly string[]): boolean | null {
  for (const key of keys) {
    if (!(key in row) || typeof row[key] !== "boolean") continue;
    return row[key] === true;
  }
  return null;
}

/** Número de envíos. `buyersCount` y `tipsSumm` son compras, no envíos. */
function sentCountOf(row: Record<string, unknown>): number | null {
  const counters = nested(row.counters);
  for (const key of ["messagesCount", "sentCount", "sendsCount", "messageCount"]) {
    if (counters && key in counters) return countOrNull(counters[key]);
    if (key in row) return countOrNull(row[key]);
  }
  return null;
}

function tagsOf(row: Record<string, unknown>, posted: boolean | null, sent: boolean | null): string[] {
  const tags: string[] = [];
  if (posted === true) tags.push("Feed");
  if (posted === false) tags.push("Feed:no");
  if (sent === true) tags.push("Sent");
  if (sent === false) tags.push("Sent:no");
  if (row.trailer === true || row.isPreview === true || (textOf(row.type) ?? "").toLowerCase().includes("trailer")) tags.push("Tráiler");
  return [...new Set(tags)];
}

function previewOf(row: Record<string, unknown>): string | null {
  const files = nested(row.files);
  return firstFileUrl(files?.squarePreview)
    ?? firstFileUrl(files?.preview)
    ?? firstFileUrl(row.squarePreview)
    ?? firstFileUrl(row.preview)
    ?? thumbOf(row)
    ?? firstFileUrl(files?.full)
    ?? firstFileUrl(row.src)
    ?? firstFileUrl(row.previewUrl);
}

function thumbOf(row: Record<string, unknown>): string | null {
  const files = nested(row.files);
  return firstFileUrl(files?.thumb) ?? firstFileUrl(row.thumb);
}

/** Misma elección que «Ver». Una jpg no se reproduce. */
function clipOf(row: Record<string, unknown>): string | null {
  return choosePlayableVideo(row)?.url ?? null;
}

/** La CDN de OnlyFans suele firmar el archivo sin extensión. Una jpg sigue sin valer. */
export function isCandidateVideoUrl(url: string): boolean {
  if (!/^https?:\/\//i.test(url)) return false;
  const path = url.split("?")[0]?.toLowerCase() ?? "";
  return !/\.(jpe?g|png|gif|webp|avif|bmp)$/.test(path);
}

/**
 * En el medio, `listStates` trae el catálogo. `hasMedia: true` (o 1, o `has_media`)
 * es la lista en la que está ese medio. Sin esa marca no es pertenencia:
 * antes cada medio acababa en todas las listas.
 */
export function mediaMemberIds(row: Record<string, unknown>): string[] {
  const raw = row.listStates ?? row.listsStates ?? row.list_states;
  if (!Array.isArray(raw)) return [];
  const states = raw.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object" && !Array.isArray(entry));
  const members = states.filter((state) => stateSaysMember(state));
  if (states.length >= 2 && members.length === states.length) return [];
  const ids: string[] = [];
  for (const state of members) {
    const id = textOf(state.id ?? state.listId ?? state.list_id);
    if (!id || id === "all") continue;
    ids.push(id);
  }
  return [...new Set(ids)];
}

/**
 * URL de reproducción de un vídeo. `files.full`, `source.source` o `videoSources`.
 * Una jpg de thumb, preview o squarePreview no vale.
 */
export function videoFileOf(row: Record<string, unknown>): string | null {
  const chosen = choosePlayableVideo(row);
  const mark = vaultFolderMark(textOf(row.id) ?? "");
  const shape = videoShapeLine(row);
  if (chosen) {
    if (liveViewDebug()) console.info(`[fanlink:vault] video medio=${mark} elige=${chosen.name} ${shape}`.slice(0, 360));
    return chosen.url;
  }
  console.info(`[fanlink:vault] video medio=${mark} motivo=sin-url ${shape}`.slice(0, 360));
  return null;
}

/** «Ver» y el hover recorren los campos en el mismo orden y se quedan con el primero que es vídeo. */
export function choosePlayableVideo(row: Record<string, unknown>): { name: string; url: string } | null {
  const files = nested(row.files);
  const full = nested(files?.full);
  const source = nested(row.source) ?? nested(files?.source);
  const sources = nested(row.videoSources);
  const fields: Array<{ name: string; value: unknown }> = [
    { name: "files.full", value: files?.full },
    { name: "files.full.sources", value: full?.sources },
    { name: "source.source", value: source?.source ?? source },
    { name: "source", value: row.source },
    { name: "videoSources.720", value: sources?.["720"] },
    { name: "videoSources.240", value: sources?.["240"] },
  ];
  if (sources) {
    for (const key of Object.keys(sources).filter((item) => /^\d+$/.test(item) && item !== "720" && item !== "240").sort((left, right) => Number(right) - Number(left))) {
      fields.push({ name: `videoSources.${key}`, value: sources[key] });
    }
  }
  for (const field of fields) {
    const url = playableFrom(field.value);
    if (url && !isPlaylistUrl(url)) return { name: field.name, url };
  }
  return null;
}

function drmHostAllowed(value: string): boolean {
  if (mediaHostAllowed(value)) return true;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname.toLowerCase().endsWith(".cloudfront.net");
  } catch {
    return false;
  }
}

/** Chrome pide el DASH. El HLS queda si no hay mpd. */
export function drmPlaybackChoice(row: Record<string, unknown>): { kind: "dash" | "hls"; url: string } | null {
  const manifest = nested(nested(nested(row.files)?.drm)?.manifest);
  if (!manifest) return null;
  const dash = textOf(manifest.dash);
  if (dash && drmHostAllowed(dash)) return { kind: "dash", url: dash };
  const hls = textOf(manifest.hls);
  if (hls && drmHostAllowed(hls) && /\.m3u8(?:$|\?)/i.test(hls)) return { kind: "hls", url: hls };
  return null;
}

/** El manifiesto HLS/DASH, si el detalle no trae mp4. No incluye la firma. */
export function drmManifestUrl(row: Record<string, unknown>): string | null {
  const manifest = nested(nested(nested(row.files)?.drm)?.manifest);
  if (!manifest) return null;
  for (const key of ["hls", "dash"] as const) {
    const value = textOf(manifest[key]);
    if (value && drmHostAllowed(value)) return value;
  }
  return null;
}

/** La primera URL de medio de una lista HLS. Ignora otras listas. */
export function playlistMediaUrl(body: string, base: string): string | null {
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    let url: URL;
    try {
      url = new URL(line, base);
    } catch {
      continue;
    }
    if (url.protocol !== "https:") continue;
    const href = url.toString();
    if (isPlaylistUrl(href) || isSegmentUrl(href) || !isCandidateVideoUrl(href)) continue;
    return href;
  }
  return null;
}

/**
 * Jose entra por el mp4 del listado. Si el detalle solo trae lista, se lee una vez
 * y el mp4 sigue el mismo reproductor.
 */
export async function resolveDetailPlayback(
  row: Record<string, unknown>,
  readText: (url: string) => Promise<string | null>,
  pause: () => Promise<void>,
): Promise<{ url: string | null; via: "archivo" | "lista" | "sin-url" }> {
  const direct = choosePlayableVideo(row);
  if (direct) return { url: direct.url, via: "archivo" };
  const manifest = drmManifestUrl(row);
  if (!manifest) return { url: null, via: "sin-url" };
  if (!isPlaylistUrl(manifest) && isCandidateVideoUrl(manifest)) return { url: manifest, via: "archivo" };
  await pause();
  const body = await readText(manifest);
  const media = body ? playlistMediaUrl(body, manifest) : null;
  return { url: media, via: media ? "lista" : "sin-url" };
}

function isPlaylistUrl(url: string): boolean {
  const path = url.split("?")[0]?.toLowerCase() ?? "";
  return path.endsWith(".m3u8") || path.endsWith(".mpd");
}

/** Un .ts o .m4s es un trozo, no el vídeo entero. */
function isSegmentUrl(url: string): boolean {
  const path = url.split("?")[0]?.toLowerCase() ?? "";
  return /\.(m4s|cmfv|cmfa|ts)$/.test(path);
}

/** Forma de los campos de vídeo, sin URL ni ids. Sirve para comparar cuentas. */
export function videoShapeLine(row: Record<string, unknown>): string {
  const files = nested(row.files);
  const source = nested(row.source) ?? nested(files?.source);
  const sources = nested(row.videoSources);
  const parts = [
    videoFlagLine(row),
    `files.full=${valueKind(files?.full)}`,
    `files.full.sources=${valueKind(nested(files?.full)?.sources)}`,
    `files.source=${valueKind(files?.source)}`,
    `source=${valueKind(row.source)}`,
    `source.source=${valueKind(source?.source)}`,
  ];
  if (!sources) parts.push("videoSources=ausente");
  else {
    const keys = Object.keys(sources).filter((key) => /^\d+$/.test(key)).slice(0, 4);
    parts.push(keys.length ? `videoSources=${keys.map((key) => `${key}:${valueKind(sources[key])}`).join(",")}` : "videoSources=vacio");
  }
  return parts.join(" ");
}

/** El detalle de un medio puede venir suelto, en `data` o en `list`. */
export function vaultDetailRow(body: unknown): Record<string, unknown> | null {
  const row = nested(body);
  if (!row) return null;
  if (row.id != null && (row.type != null || row.files != null || row.videoSources != null)) return row;
  const data = nested(row.data);
  if (data?.id != null) return data;
  const list = Array.isArray(row.list) ? row.list.find((item) => item && typeof item === "object") : null;
  return nested(list);
}

export function videoFlagLine(row: Record<string, unknown>): string {
  const files = nested(row.files);
  const source = nested(row.source) ?? nested(files?.source);
  const sample = textOf(nested(files?.full)?.url) ?? textOf(nested(files?.source)?.url) ?? textOf(source?.source) ?? textOf(source?.url);
  return `convertedToVideo=${flagWord(row.convertedToVideo)} canView=${flagWord(row.canView)} hasError=${flagWord(row.hasError)} isReady=${flagWord(row.isReady)} tipo=${videoContainer({ url: sample })} ${videoDrmLine(row)}`;
}

/** Extensión, content-type o bytes. `qt  ` es QuickTime. RIFF/AVI no se reproduce en el navegador. */
export function videoContainer(input: { url?: string | null; contentType?: string | null; head?: Uint8Array | null }): "mp4" | "mov" | "avi" | "otro" | "ausente" {
  const head = input.head ?? null;
  if (head && head.length >= 12 && asciiAt(head, 0) === "RIFF" && asciiAt(head, 8) === "AVI ") return "avi";
  const ftypAt = head ? indexOfAscii(head, "ftyp") : -1;
  if (head && ftypAt >= 0 && head.length >= ftypAt + 8) {
    return asciiAt(head, ftypAt + 4) === "qt  " ? "mov" : "mp4";
  }
  const type = (input.contentType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  if (type === "video/quicktime") return "mov";
  if (type === "video/mp4") return "mp4";
  if (type === "video/avi" || type === "video/msvideo" || type === "video/x-msvideo" || type === "video/x-avi") return "avi";
  const path = (input.url ?? "").split("?")[0]?.toLowerCase() ?? "";
  if (path.endsWith(".mov")) return "mov";
  if (path.endsWith(".avi")) return "avi";
  if (path.endsWith(".mp4") || path.endsWith(".m4v")) return "mp4";
  if (input.url || input.contentType || input.head) return "otro";
  return "ausente";
}

/** Chrome no reproduce el MIME video/quicktime. Un ftyp `qt  ` es ISO BMFF y se sirve como video/mp4. AVI no. */
export function browserVideoType(container: ReturnType<typeof videoContainer>): string | null {
  if (container === "mov" || container === "mp4") return "video/mp4";
  return null;
}

export function videoFormatHold(container: ReturnType<typeof videoContainer>): { texto: string; abrir: boolean } | null {
  if (container !== "avi") return null;
  return { texto: "Este vídeo es AVI y el navegador no puede reproducirlo.", abrir: true };
}

function asciiAt(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(bytes[offset] ?? 0, bytes[offset + 1] ?? 0, bytes[offset + 2] ?? 0, bytes[offset + 3] ?? 0);
}

function indexOfAscii(bytes: Uint8Array, needle: string): number {
  const limit = Math.min(bytes.length - needle.length, 32);
  for (let index = 0; index <= limit; index += 1) {
    let found = true;
    for (let cursor = 0; cursor < needle.length; cursor += 1) {
      if (bytes[index + cursor] !== needle.charCodeAt(cursor)) {
        found = false;
        break;
      }
    }
    if (found) return index;
  }
  return -1;
}

/**
 * `files.drm` es el manifiesto HLS o DASH con la firma de CloudFront.
 * El archivo va cifrado y un reproductor normal no lo descifra.
 * La línea solo dice si hay manifiesto, nunca la URL ni la firma.
 */
export function videoDrmLine(row: Record<string, unknown>): string {
  const drm = nested(nested(row.files)?.drm);
  if (!drm) return "drm=no";
  const manifest = nested(drm.manifest);
  const kinds = (["hls", "dash"] as const).filter((key) => typeof manifest?.[key] === "string" && (manifest[key] as string).trim() !== "");
  return `drm=si manifest=${kinds.length ? kinds.join("+") : "ausente"}`;
}

export function videoNeedsOnlyFans(row: Record<string, unknown> | null): boolean {
  if (!row || choosePlayableVideo(row) || drmManifestUrl(row)) return false;
  return Boolean(nested(nested(row.files)?.drm));
}

export function videoHoldText(row: Record<string, unknown> | null): string {
  if (row?.hasError === true) return "OnlyFans no ha podido procesar el vídeo";
  if (row?.isReady === false) return "Vídeo aún procesándose en OnlyFans";
  if (row?.canView === false) return "No se puede ver este vídeo";
  if (videoNeedsOnlyFans(row)) return "Este vídeo está protegido por OnlyFans y no se puede reproducir aquí.";
  return "Vídeo no disponible";
}

/** 401 o 429 del detalle: el visor no insiste. */
export function videoDetailHold(status: number | null, row: Record<string, unknown> | null): string {
  if (status === 401 || status === 429) return "OnlyFans está limitando, prueba en un momento";
  return videoHoldText(row);
}

/** Cuerpo del 409. `abrir` solo si OnlyFans tampoco tiene manifiesto ni mp4. */
export function videoHoldPayload(status: number | null, row: Record<string, unknown> | null): { texto: string; abrir: boolean } {
  return { texto: videoDetailHold(status, row), abrir: status !== 401 && status !== 429 && videoNeedsOnlyFans(row) };
}

function flagWord(value: unknown): string {
  if (value === true || value === 1) return "si";
  if (value === false || value === 0) return "no";
  return "ausente";
}

function valueKind(value: unknown): string {
  if (value == null) return "ausente";
  if (typeof value === "string") return urlKind(value);
  if (Array.isArray(value)) return value.length === 0 ? "vacio" : `lista:${value.length}`;
  const row = nested(value);
  if (!row) return "otro";
  const bits = ["url", "src", "source"].map((key) => `${key}:${urlKind(textOf(row[key]))}`);
  return `objeto ${bits.join(" ")}`;
}

function urlKind(value: string | null): string {
  if (!value) return "ausente";
  if (!/^https?:\/\//i.test(value)) return "no-http";
  const path = value.split("?")[0]?.toLowerCase() ?? "";
  const query = value.includes("?") ? value.slice(value.indexOf("?") + 1) : "";
  const firma = /(?:^|&)(?:policy|expires|signature|x-amz-)/i.test(query) ? "+firma" : "";
  if (/\.(jpe?g|png|gif|webp|avif|bmp)$/.test(path)) return `imagen${firma}`;
  if (/\.(mp4|webm|mov|m4v)$/.test(path)) return `ext${firma}`;
  return `sin-ext${firma}`;
}

function playableFrom(value: unknown): string | null {
  if (typeof value === "string") return isCandidateVideoUrl(value) ? value : null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = playableFrom(item);
      if (found) return found;
    }
    return null;
  }
  const row = nested(value);
  if (!row) return null;
  for (const key of ["url", "src", "source"]) {
    const text = textOf(row[key]);
    if (text && isCandidateVideoUrl(text)) return text;
  }
  if (Array.isArray(row.sources)) return playableFrom(row.sources);
  return null;
}

/** Cuántos medios de la página dicen, por listStates, que están en esa carpeta. */
export function mediaStateHits(body: unknown, listId: string): number {
  return vaultMediaMatching(body, listId).length;
}

/** Medios de una página cuyo listStates marca esa carpeta. El resto no entra. */
export function vaultMediaMatching(body: unknown, listId: string): Record<string, unknown>[] {
  const needle = listId.trim();
  if (!needle) return [];
  return mediaRows(body).filter((row) => mediaMemberIds(row).some((id) => id === needle));
}

function listMembership(row: Record<string, unknown>, _lists: readonly VaultList[]): {
  listId: string | null;
  listName: string | null;
  listIds: string[];
} {
  const listIds = mediaMemberIds(row);
  const listId = listIds[0] ?? null;
  return { listId, listName: listId ? memberName(row, listId) : null, listIds };
}

function stateSaysMember(state: Record<string, unknown>): boolean {
  const flag = state.hasMedia ?? state.has_media;
  if (flag === true || flag === 1) return true;
  if (flag === false || flag === 0) return false;
  return state.inList === true || state.isInList === true || state.added === true || state.isAdded === true;
}

function memberName(row: Record<string, unknown>, listId: string): string | null {
  const raw = row.listStates ?? row.listsStates ?? row.list_states;
  if (!Array.isArray(raw)) return null;
  for (const entry of raw) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const state = entry as Record<string, unknown>;
    const id = textOf(state.id ?? state.listId ?? state.list_id);
    if (id !== listId) continue;
    return textOf(state.name ?? state.title);
  }
  return null;
}

function mediaRows(body: unknown): Record<string, unknown>[] {
  if (!body || typeof body !== "object" || Array.isArray(body)) return [];
  const raw = body as Record<string, unknown>;
  for (const key of ["list", "items", "media"]) {
    if (!Array.isArray(raw[key])) continue;
    return raw[key].filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item));
  }
  return [];
}

/** Marca corta de una carpeta. No es el id ni el nombre. */
export function vaultFolderMark(id: string): string {
  if (!id || id === "all") return "todos";
  let hash = 2166136261;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0").slice(0, 6);
}

/** Tope de medios de una carpeta: la suma de sus conteos más un margen. */
export function folderMediaCap(counts: { photos?: number | null; videos?: number | null; gifs?: number | null; audios?: number | null } | null | undefined): number | null {
  if (!counts) return null;
  const values = [counts.photos, counts.videos, counts.gifs, counts.audios].map(countOrZero);
  if (values.every((value) => value == null)) return null;
  let sum = 0;
  for (const value of values) sum += value ?? 0;
  return sum + Math.max(4, Math.ceil(sum * 0.2));
}

function countOrZero(value: number | null | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

function collectFolders(payload: unknown, lists: VaultList[]): void {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return;
  for (const value of Object.values(payload as Record<string, unknown>)) {
    if (!Array.isArray(value)) continue;
    for (const entry of value) {
      const folder = folderFrom(entry);
      if (folder) mergeFolder(lists, folder);
    }
  }
}

function mergeFolder(lists: VaultList[], folder: VaultList): void {
  const index = lists.findIndex((list) => list.id === folder.id);
  if (index < 0) {
    lists.push(folder);
    return;
  }
  lists[index] = mergeVaultList(lists[index]!, folder);
}

/** Une dos vistas de la misma lista. Un conteo ausente no borra el que ya vino, ni copia el de otra lista. */
export function mergeVaultList(prev: VaultList, next: VaultList): VaultList {
  return {
    ...next,
    ...prev,
    name: prev.name || next.name,
    photos: prev.photos ?? next.photos,
    videos: prev.videos ?? next.videos,
    gifs: prev.gifs ?? next.gifs,
    audios: prev.audios ?? next.audios,
    hasMedia: prev.hasMedia ?? next.hasMedia,
    count: prev.count ?? next.count,
    type: prev.type || next.type,
    covers: prev.covers && prev.covers.length > 0 ? prev.covers : next.covers,
    sourceKeys: [prev.sourceKeys, next.sourceKeys].filter(Boolean).join(","),
  };
}

function folderFrom(entry: unknown): VaultList | null {
  if (!isFolderRow(entry)) return null;
  const row = entry as Record<string, unknown>;
  const id = textOf(row.id);
  const name = textOf(row.name ?? row.title);
  if (!id || !name) return null;
  const counts = listCounts(row);
  if (counts.hasMedia == null && counts.count != null) counts.hasMedia = counts.count > 0;
  return {
    id,
    name,
    type: (textOf(row.type) ?? "").toLowerCase() || undefined,
    ...counts,
    covers: coversOf(row),
    sourceKeys: vaultKeyNames(row),
  };
}

/** `medias` de la lista. Solo id y tipo: la URL no sale de aquí. */
function coversOf(row: Record<string, unknown>): Array<{ id: string; kind: VaultKind }> {
  const medias = row.medias ?? row.media;
  if (!Array.isArray(medias)) return [];
  const covers: Array<{ id: string; kind: VaultKind }> = [];
  for (const entry of medias) {
    if (!entry || typeof entry !== "object") continue;
    const media = entry as Record<string, unknown>;
    const id = textOf(media.id ?? media.mediaId);
    if (!id) continue;
    covers.push({ id, kind: coverKind(media) });
    if (covers.length >= 4) break;
  }
  return covers;
}

function coverKind(row: Record<string, unknown>): VaultKind {
  const type = (textOf(row.type ?? row.kind) ?? "").toLowerCase();
  if (type.includes("video")) return "video";
  if (type.includes("audio")) return "audio";
  if (type.includes("gif")) return "gif";
  if (type.includes("photo") || type.includes("image") || type.includes("foto")) return "foto";
  return null;
}

function firstNamedArray(row: Record<string, unknown>, keys: readonly string[]): unknown[] | null {
  for (const key of keys) {
    if (Array.isArray(row[key])) return row[key] as unknown[];
  }
  return null;
}

function vaultLists(payload: unknown): VaultList[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
  const row = payload as Record<string, unknown>;
  const raw = row.lists ?? row.folders;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    const folder = folderFrom(item);
    return folder ? [folder] : [];
  });
}

function listCounts(list: Record<string, unknown>): Pick<VaultList, "photos" | "videos" | "gifs" | "audios" | "hasMedia" | "count"> {
  const bags = countBags(list);
  return {
    photos: pickCount(bags, ["photosCount", "photoCount", "photos_count", "photo_count", "photos", "photo", "imagesCount", "imageCount", "image_count"]),
    videos: pickCount(bags, ["videosCount", "videoCount", "videos_count", "video_count", "videos", "video", "video_count"]),
    gifs: pickCount(bags, ["gifsCount", "gifCount", "gifs_count", "gif_count", "gifs", "gif"]),
    audios: pickCount(bags, ["audiosCount", "audioCount", "audios_count", "audio_count", "audios", "audio"]),
    hasMedia: pickBool(bags, ["hasMedia", "has_media"]),
    count: pickCount(bags, ["count", "mediasCount", "mediaCount", "medias_count"]),
  };
}

/** Solo el objeto de la lista y su bloque de conteos. `medias` y `all` no cuentan. */
function countBags(list: Record<string, unknown>): Record<string, unknown>[] {
  const bags = [list];
  for (const key of ["counts", "stats", "bag", "counters"]) {
    const child = nested(list[key]);
    if (child) bags.push(child);
  }
  return bags;
}

function pickCount(bags: readonly Record<string, unknown>[], keys: readonly string[]): number | null {
  for (const bag of bags) {
    for (const key of keys) {
      if (!(key in bag)) continue;
      const count = countOrNull(bag[key]);
      if (count == null) continue;
      return count;
    }
  }
  return null;
}

function pickBool(bags: readonly Record<string, unknown>[], keys: readonly string[]): boolean | null {
  for (const bag of bags) {
    for (const key of keys) {
      if (bag[key] === true) return true;
      if (bag[key] === false) return false;
    }
  }
  return null;
}


/** El medio pedido con `list_id` pertenece a esa lista aunque el JSON no traiga listStates. */
export function stampVaultList(item: VaultFile, listId: string, listName: string | null): VaultFile {
  if (!listId || listId === "all") return item;
  const listIds = [...new Set([...(item.listIds ?? []), listId])];
  return {
    ...item,
    listId,
    listName: listName ?? item.listName,
    folder: listName ?? item.folder,
    listIds,
  };
}

function vaultList(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  const row = payload as Record<string, unknown>;
  for (const key of ["list", "items", "medias", "media", "files"]) {
    if (Array.isArray(row[key])) return row[key] as unknown[];
  }
  const data = row.data;
  if (data && typeof data === "object") {
    if (Array.isArray(data)) return data;
    const nested = data as Record<string, unknown>;
    for (const key of ["list", "items", "medias", "media", "files"]) {
      if (Array.isArray(nested[key])) return nested[key] as unknown[];
    }
  }
  return [];
}

function nested(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function fullOf(row: Record<string, unknown>): string | null {
  const files = nested(row.files);
  return firstFileUrl(files?.full) ?? firstFileUrl(files?.source) ?? firstFileUrl(row.source) ?? firstFileUrl(row.fullUrl) ?? firstFileUrl(row.src);
}

function firstFileUrl(value: unknown, depth = 0): string | null {
  if (depth > 4) return null;
  const direct = textOf(value);
  if (direct && /^https?:\/\//.test(direct)) return direct;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstFileUrl(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  const row = nested(value);
  if (!row) return null;
  const own = textOf(row.url) ?? textOf(row.src);
  if (own && /^https?:\/\//.test(own)) return own;
  for (const key of ["sources", "source", "thumb", "preview", "squarePreview", "full"]) {
    const found = firstFileUrl(row[key], depth + 1);
    if (found) return found;
  }
  return null;
}

function countOrNull(value: unknown): number | null {
  const numeric = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim()
      ? Number(value.trim())
      : Number.NaN;
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  return Math.round(numeric);
}

function textOf(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}
