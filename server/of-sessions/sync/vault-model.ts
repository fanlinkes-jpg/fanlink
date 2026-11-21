import { textSaleBlocked } from "./vault-block.ts";

export type VaultKind = "foto" | "video" | "audio" | "gif" | null;

export type VaultFile = {
  id: string;
  title: string;
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
  const list = firstNamedArray(row, ["list", "lists", "folders"]);
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
  const text = `${item.title} ${item.tags.join(" ")}`.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
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
  const title = (textOf(row.title ?? row.name ?? row.fileName) ?? "Sin datos").slice(0, 120);
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
  const seconds = countOrNull(row.duration ?? row.durationSeconds);
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
    fullUrl: fullOf(row),
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
  const states = Array.isArray(row.listStates) ? row.listStates : [];
  for (const entry of states) {
    if (!entry || typeof entry !== "object") continue;
    const list = entry as Record<string, unknown>;
    const name = textOf(list.name);
    const type = (textOf(list.type) ?? "").toLowerCase();
    if (name && type !== "posts" && name !== "Posts") tags.push(name);
  }
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

/** Clip de verdad: la rendición más pequeña de `videoSources`, o preview/squarePreview si el archivo es vídeo. Una jpg no se reproduce. */
function clipOf(row: Record<string, unknown>): string | null {
  const sources = nested(row.videoSources);
  if (sources) {
    const keys = Object.keys(sources).filter((key) => /^\d+$/.test(key)).sort((left, right) => Number(left) - Number(right));
    for (const key of keys) {
      const url = mediaUrl(sources[key]);
      if (url && isVideoUrl(url)) return url;
    }
  }
  const files = nested(row.files);
  for (const key of ["src", "source", "full", "preview", "squarePreview"]) {
    const url = firstFileUrl(files?.[key]) ?? firstFileUrl(row[key]);
    if (url && isVideoUrl(url)) return url;
  }
  return null;
}

function mediaUrl(value: unknown): string | null {
  if (typeof value === "string" && /^https?:\/\//.test(value)) return value;
  return firstFileUrl(value);
}

function isVideoUrl(url: string): boolean {
  const path = url.split("?")[0]?.toLowerCase() ?? "";
  return path.endsWith(".mp4") || path.endsWith(".webm") || path.endsWith(".mov") || path.endsWith(".m4v");
}

const SYSTEM_LISTS = new Set(["posts", "stories", "messages", "streams", "media"]);

function listMembership(row: Record<string, unknown>, lists: readonly VaultList[]): {
  listId: string | null;
  listName: string | null;
  listIds: string[];
} {
  const states = Array.isArray(row.listStates) ? row.listStates : [];
  const parsed = states.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const list = entry as Record<string, unknown>;
    const id = textOf(list.id);
    if (!id) return [];
    return [{ id, name: textOf(list.name), type: (textOf(list.type) ?? "").toLowerCase() }];
  });
  const custom = parsed.find((list) => !SYSTEM_LISTS.has(list.type));
  const chosen = custom ?? parsed[0];
  const listId = chosen?.id ?? null;
  const listName = chosen?.name ?? lists.find((list) => list.id === listId)?.name ?? null;
  return { listId, listName, listIds: [...new Set(parsed.map((list) => list.id))] };
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
  const prev = lists[index]!;
  lists[index] = {
    ...folder,
    ...prev,
    name: prev.name || folder.name,
    photos: prev.photos ?? folder.photos,
    videos: prev.videos ?? folder.videos,
    gifs: prev.gifs ?? folder.gifs,
    audios: prev.audios ?? folder.audios,
    hasMedia: prev.hasMedia ?? folder.hasMedia,
    count: prev.count ?? folder.count,
    type: prev.type ?? folder.type,
    sourceKeys: [prev.sourceKeys, folder.sourceKeys].filter(Boolean).join(","),
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
  return { id, name, type: (textOf(row.type) ?? "").toLowerCase() || undefined, ...counts, sourceKeys: vaultKeyNames(row) };
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

function countBags(list: Record<string, unknown>): Record<string, unknown>[] {
  const bags = [list];
  for (const value of Object.values(list)) {
    const child = nested(value);
    if (child) bags.push(child);
  }
  return bags;
}

function pickCount(bags: readonly Record<string, unknown>[], keys: readonly string[]): number | null {
  for (const bag of bags) {
    for (const key of keys) {
      if (!(key in bag)) continue;
      return countOrNull(bag[key]);
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


/** El medio pedido con `list=<id>` pertenece a esa lista aunque el JSON no traiga listStates. */
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
  for (const key of ["list", "items", "media", "files"]) {
    if (Array.isArray(row[key])) return row[key] as unknown[];
  }
  const data = row.data;
  if (data && typeof data === "object") {
    if (Array.isArray(data)) return data;
    const nested = data as Record<string, unknown>;
    for (const key of ["list", "items", "media", "files"]) {
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
  const own = textOf(row.url);
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
