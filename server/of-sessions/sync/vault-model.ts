import { textSaleBlocked } from "./vault-block.ts";

export type VaultKind = "foto" | "video" | "audio" | null;

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
  /** Id del vídeo de pago, si el tráiler lo dice. Sin esto no se empareja. */
  paidWithId?: string | null;
};

export type VaultList = { id: string; name: string };

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
  const raw = vaultList(payload);
  for (const entry of raw) {
    if (!isFolderRow(entry)) continue;
    const row = entry as Record<string, unknown>;
    const id = textOf(row.id);
    const name = textOf(row.name ?? row.title);
    if (id && name && !lists.some((list) => list.id === id)) lists.push({ id, name });
  }
  const items = raw.filter((entry) => !isFolderRow(entry)).flatMap((item) => parseVaultItem(item, lists));
  return { items, lists };
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
  const kind: VaultKind = type.includes("video")
    ? "video"
    : type.includes("audio")
      ? "audio"
      : type.includes("photo") || type.includes("image") || type.includes("foto")
        ? "foto"
        : null;
  const secondsValue = row.duration ?? row.durationSeconds;
  const seconds = typeof secondsValue === "number" && Number.isFinite(secondsValue) && secondsValue >= 0
    ? Math.round(secondsValue)
    : null;
  const states = Array.isArray(row.listStates) ? row.listStates : [];
  const firstList = states.find((entry) => entry && typeof entry === "object") as Record<string, unknown> | undefined;
  const listId = textOf(firstList?.id);
  const listName = textOf(firstList?.name) ?? lists.find((list) => list.id === listId)?.name ?? null;
  return [{
    id,
    title,
    kind,
    seconds,
    preview: previewOf(row),
    folder: listName,
    tags: tagsOf(row),
    listId,
    listName,
    description: textOf(row.description ?? row.caption ?? row.text),
    uploadedAt: textOf(row.uploadedAt ?? row.createdAt),
    priceCents: priceToCents(row),
    salesCount: countOrNull(row.salesCount ?? row.purchases),
    sentCount: countOrNull(row.sentCount ?? row.sent),
    fullUrl: fullOf(row),
    paidWithId: textOf(row.paidMediaId ?? row.pairedMediaId ?? row.fullMediaId),
  }];
}

function tagsOf(row: Record<string, unknown>): string[] {
  const tags: string[] = [];
  if (row.hasPosts === true || row.isPosted === true || row.posted === true) tags.push("Feed");
  if (row.isSent === true || row.sent === true) tags.push("Sent");
  if (row.trailer === true || row.isPreview === true || (textOf(row.type) ?? "").toLowerCase().includes("trailer")) tags.push("Tráiler");
  const states = Array.isArray(row.listStates) ? row.listStates : [];
  for (const entry of states) {
    if (!entry || typeof entry !== "object") continue;
    const list = entry as Record<string, unknown>;
    const name = textOf(list.name);
    const type = (textOf(list.type) ?? "").toLowerCase();
    if (type === "posts" || name === "Posts") tags.push("Feed");
    else if (name) tags.push(name);
  }
  return [...new Set(tags)];
}

function previewOf(row: Record<string, unknown>): string | null {
  const files = nested(row.files);
  const thumb = nested(files?.thumb) ?? nested(row.thumb) ?? nested(row.preview);
  return textOf(thumb?.url ?? files?.squarePreview ?? row.previewUrl);
}

function vaultLists(payload: unknown): VaultList[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
  const row = payload as Record<string, unknown>;
  const raw = row.lists ?? row.folders;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const list = item as Record<string, unknown>;
    const id = textOf(list.id);
    const name = textOf(list.name ?? list.title);
    if (!id || !name) return [];
    return [{ id, name }];
  });
}

function vaultList(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  const row = payload as Record<string, unknown>;
  for (const key of ["list", "items", "media", "files"]) {
    if (Array.isArray(row[key])) return row[key] as unknown[];
  }
  return [];
}

function nested(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function fullOf(row: Record<string, unknown>): string | null {
  const files = nested(row.files);
  const source = nested(files?.source) ?? nested(files?.full) ?? nested(row.source);
  return textOf(source?.url ?? row.fullUrl ?? row.src);
}

function countOrNull(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return Math.round(value);
}

function textOf(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}
