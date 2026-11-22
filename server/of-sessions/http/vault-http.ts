import { deliverChatSend, type DeliverSale } from "../send/deliver.ts";
import { deliverMassVault } from "../send/mass-vault.ts";
import { mediaHostAllowed } from "../sync/history.ts";
import { loadSaleContext } from "../sync/vault-store.ts";
import type { ReadSql } from "../sync/store.ts";
import { creatorAllowed, queryVaultForActor, type VaultActor } from "../sync/vault-query.ts";
import type { MassEnv } from "../../../src/lib/mass/gates.ts";
import { liveViewDebug } from "../live/debug.ts";
import { vaultFolderMark } from "../sync/vault-model.ts";
import { getVaultThumb, type MediaBytes } from "../sync/media-bytes.ts";

export type SessionActor = VaultActor | null;

export function mediaLogLine(creatorId: string, messageKey: string): string | null {
  if (!liveViewDebug()) return null;
  return `[fanlink:media] creator=${vaultFolderMark(creatorId)} message=${vaultFolderMark(messageKey)}`;
}

/** Un solo `[fanlink:media]` por medio aunque «Ver» repita la petición. */
export function takeMediaLog(creatorId: string, mediaId: string): string | null {
  const line = mediaLogLine(creatorId, mediaId);
  if (!line) return null;
  const key = `media\n${creatorId}\n${mediaId}`;
  const now = Date.now();
  if (now - (playNotes.get(key) ?? 0) < PLAY_NOTE_MS) return null;
  playNotes.set(key, now);
  return line;
}

export function playbackDebugLine(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  const tipo = safePlaybackToken(record.tipo);
  const detalle = safePlaybackToken(record.detalle);
  if (!tipo && !detalle) return null;
  const fatal = record.fatal === true || record.fatal === "si" ? "si" : "no";
  const codigo = typeof record.codigo === "number" && Number.isInteger(record.codigo) ? String(record.codigo) : "no";
  const medio = typeof record.mediaId === "string" ? vaultFolderMark(record.mediaId) : "no";
  return `[fanlink:vault] reproductor error medio=${medio} tipo=${tipo || "no"} detalle=${detalle || "no"} fatal=${fatal} codigo=${codigo}`;
}

function safePlaybackToken(value: unknown): string {
  if (typeof value !== "string") return "";
  if (/https?:|onlyfans|cloudfront|cookie|policy|signature/i.test(value)) return "oculto";
  return value.replace(/[^A-Za-z0-9._:-]/g, "").slice(0, 60);
}

const playNotes = new Map<string, number>();
const PLAY_NOTE_MS = 4_000;

/** Un solo `ver` por medio aunque el reproductor repita la petición. */
export function clearPlayNotes(): void {
  playNotes.clear();
}

/** Cada «Ver» o el hover deja una línea antes de leer la sesión. Sin URL ni id.
 * «Ver» registra `ver variant=full`. El hover registra `ver variant=clip`.
 */
export function noteVaultPlayRequest(request: Request): void {
  const url = new URL(request.url);
  const variant = url.searchParams.get("variant");
  if (variant !== "full" && variant !== "clip") return;
  const mediaId = url.searchParams.get("mediaId") ?? "";
  const key = `${variant}\n${mediaId}`;
  const now = Date.now();
  const last = playNotes.get(key) ?? 0;
  if (now - last < PLAY_NOTE_MS) return;
  playNotes.set(key, now);
  console.info(`[fanlink:vault] ver variant=${variant} medio=${vaultFolderMark(mediaId)}`);
}

/** El cliente cerró la petición. No es un 500. */
export function isClientAbort(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as { name?: unknown; code?: unknown; message?: unknown; cause?: unknown };
  const name = typeof record.name === "string" ? record.name : "";
  const code = typeof record.code === "string" ? record.code : "";
  const message = typeof record.message === "string" ? record.message : "";
  if (name === "AbortError" || code === "ECONNRESET" || code === "ABORT_ERR" || message === "aborted") return true;
  return isClientAbort(record.cause);
}

export function abortResponse(error: unknown, signal?: AbortSignal): Response | null {
  if (!signal?.aborted || !isClientAbort(error)) return null;
  return new Response(null, { status: 499 });
}

export async function handleVaultQuery(request: Request, deps: {
  session: () => Promise<SessionActor>;
  sql: ReadSql;
}): Promise<Response> {
  const actor = await deps.session();
  if (!actor) return new Response("Unauthorized", { status: 401 });
  const body = await readJson(request);
  const result = await queryVaultForActor(deps.sql, actor, body);
  return Response.json(result.payload, { status: result.status });
}

export async function handleChatMedia(request: Request, deps: {
  session: () => Promise<SessionActor>;
  findMedia: (creatorId: string, threadKey: string, messageKey: string, index: number) => Promise<{ url: string | null } | null>;
  fetchBytes: (url: string, range?: string | null) => Promise<MediaBytes | null>;
  log?: (line: string) => void;
}): Promise<Response> {
  const actor = await deps.session();
  if (!actor) return new Response("Unauthorized", { status: 401 });
  if (!canReadMedia(actor)) return new Response("Forbidden", { status: 403 });
  const url = new URL(request.url);
  const creatorId = url.searchParams.get("creatorId") ?? "";
  const threadKey = url.searchParams.get("threadKey") ?? "";
  const messageKey = url.searchParams.get("messageKey") ?? "";
  const index = Number(url.searchParams.get("index") ?? "0");
  const mediaLine = mediaLogLine(creatorId, messageKey);
  if (mediaLine) deps.log?.(mediaLine);
  if (!creatorId || !messageKey || !Number.isInteger(index) || index < 0) return new Response("Sin datos", { status: 404 });
  if (!creatorAllowed(actor, creatorId)) return new Response("Sin datos", { status: 403 });
  const row = await deps.findMedia(creatorId, threadKey, messageKey, index);
  return streamMedia(row?.url ?? null, request.headers.get("range"), deps.fetchBytes);
}

export async function handleVaultMedia(request: Request, deps: {
  session: () => Promise<SessionActor>;
  findPreview: (creatorId: string, mediaId: string, variant?: "full" | "preview" | "clip") => Promise<string | null>;
  fetchBytes: (url: string, range?: string | null, signal?: AbortSignal) => Promise<MediaBytes | null>;
  log?: (line: string) => void;
  /** Texto para el visor cuando un vídeo sigue sin URL después del detalle. */
  videoHold?: () => string | null;
}): Promise<Response> {
  const actor = await deps.session();
  if (!actor) return new Response("Unauthorized", { status: 401 });
  if (!canReadMedia(actor)) return new Response("Forbidden", { status: 403 });
  const url = new URL(request.url);
  const creatorId = url.searchParams.get("creatorId") ?? "";
  const mediaId = url.searchParams.get("mediaId") ?? "";
  const rawVariant = url.searchParams.get("variant");
  const variant = rawVariant === "full" || rawVariant === "clip" ? rawVariant : "preview";
  const mediaLine = takeMediaLog(creatorId, mediaId);
  if (mediaLine) deps.log?.(mediaLine);
  if (!creatorId || !mediaId) return new Response("Sin datos", { status: 404 });
  if (!creatorAllowed(actor, creatorId)) return new Response("Sin datos", { status: 403 });
  if (variant === "preview" && !request.headers.get("range")) {
    const cached = getVaultThumb(creatorId, mediaId);
    if (cached) return thumbResponse(cached);
  }
  const preview = await deps.findPreview(creatorId, mediaId, variant);
  if (!preview && (variant === "full" || variant === "clip")) {
    const held = holdResponse(deps.videoHold?.()?.trim() || null);
    if (held.status !== 404) return held;
  }
  const range = url.searchParams.get("part") === "head" ? headRange(request.headers.get("range")) : request.headers.get("range");
  return streamMedia(preview, range, deps.fetchBytes, deps.videoHold, request.signal);
}

/** Con `part=head` cualquier Range se queda en el primer megabyte. El hover no baja el archivo entero. */
export function headRange(_header: string | null): string {
  return "bytes=0-1048575";
}

export async function handleVaultSend(request: Request, deps: {
  session: () => Promise<SessionActor>;
  sql: ReadSql;
  env: MassEnv & { FANLINK_SEND_ALLOW_ACCOUNTS?: string };
  openChat?: () => Promise<{ messageId: string | null; reason: string | null }>;
  openMass?: () => Promise<void>;
}): Promise<Response> {
  const actor = await deps.session();
  if (!actor) return new Response("Unauthorized", { status: 401 });
  if (actor.role !== "owner" && !actor.perms.includes("mensajes") && !actor.perms.includes("vault")) {
    return Response.json({ sent: false, opened: false, reason: "Forbidden" }, { status: 403 });
  }
  const body = await readJson(request);
  const record = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const mode = record.mode === "mass" ? "mass" : "chat";
  const creatorId = typeof record.creatorId === "string" ? record.creatorId : "";
  if (creatorId && !creatorAllowed(actor, creatorId)) {
    return Response.json({ sent: false, opened: false, reason: "Sin datos" }, { status: 403 });
  }
  const itemIds = Array.isArray(record.itemIds) ? record.itemIds.filter((item): item is string => typeof item === "string") : [];
  const accountId = typeof record.accountId === "string" ? record.accountId : "";
  let sales: DeliverSale[] = [];
  if (creatorId && itemIds.length > 0) {
    const loaded = await loadSaleContext(deps.sql, creatorId, itemIds);
    if (loaded.missing.length > 0) {
      return Response.json({ sent: false, opened: false, reason: "NO VENDER" }, { status: 403 });
    }
    sales = loaded.sales;
  }
  if (mode === "mass") {
    const result = await deliverMassVault({
      accountId,
      env: deps.env,
      sales,
      open: deps.openMass ?? (async () => undefined),
    });
    const status = result.reason === "NO VENDER" ? 403 : 200;
    return Response.json(result, { status });
  }
  const result = await deliverChatSend({
    flag: deps.env.FANLINK_ENABLE_SEND,
    allowlist: deps.env.FANLINK_SEND_ALLOW_ACCOUNTS,
    perMinute: 4,
    account: {
      creatorId,
      accountId: accountId || null,
      handle: typeof record.handle === "string" ? record.handle : null,
      userId: typeof record.accountUserId === "string" ? record.accountUserId : null,
      label: null,
    },
    now: () => Date.now(),
    sleep: async () => undefined,
    open: deps.openChat ?? (async () => ({ messageId: null, reason: "Sin transporte" })),
    sales,
  });
  const status = result.reason === "NO VENDER" ? 403 : 200;
  return Response.json({ sent: result.sent, opened: result.opened, reason: result.reason }, { status });
}

function canReadMedia(actor: VaultActor): boolean {
  if (actor.role === "owner") return true;
  return actor.role === "member" && (actor.perms.includes("mensajes") || actor.perms.includes("vault"));
}

async function streamMedia(
  target: string | null,
  range: string | null,
  fetchBytes: (url: string, range?: string | null, signal?: AbortSignal) => Promise<MediaBytes | null>,
  videoHold?: () => string | null,
  signal?: AbortSignal,
): Promise<Response> {
  const hold = () => videoHold?.()?.trim() || null;
  if (!target || !mediaHostAllowed(target)) return holdResponse(hold());
  const bytes = await fetchBytes(target, range, signal);
  if (!bytes) return holdResponse(hold());
  const body = mediaBody(bytes);
  if (!body) return new Response("Sin datos", { status: 404 });
  const length = bytes.contentLength ?? bytes.body?.byteLength ?? null;
  const headers = new Headers({
    "content-type": bytes.contentType || "application/octet-stream",
    "cache-control": !range && bytes.status === 200 && !bytes.contentType.includes("mpegurl") && !bytes.contentType.includes("dash") ? "private, max-age=300" : "private, no-store",
    "x-content-type-options": "nosniff",
    "accept-ranges": "bytes",
  });
  if (length != null) headers.set("content-length", String(length));
  if (bytes.contentRange) headers.set("content-range", bytes.contentRange);
  return new Response(body, { status: bytes.status, headers });
}

function holdResponse(hold: string | null): Response {
  if (!hold) return new Response("Sin datos", { status: 404 });
  const payload = holdPayload(hold);
  if (payload) {
    return new Response(JSON.stringify(payload), {
      status: 409,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "private, no-store" },
    });
  }
  return new Response(hold, {
    status: 409,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "private, no-store" },
  });
}

function holdPayload(hold: string): { texto: string; abrir: boolean } | null {
  try {
    const parsed = JSON.parse(hold) as { texto?: unknown; abrir?: unknown };
    if (typeof parsed.texto !== "string") return null;
    return { texto: parsed.texto, abrir: parsed.abrir === true };
  } catch {
    return null;
  }
}

function thumbResponse(cached: { body: Uint8Array; contentType: string }): Response {
  const body = cached.body.buffer.slice(cached.body.byteOffset, cached.body.byteOffset + cached.body.byteLength) as ArrayBuffer;
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": cached.contentType,
      "cache-control": "private, max-age=300",
      "x-content-type-options": "nosniff",
    },
  });
}

function mediaBody(bytes: MediaBytes): BodyInit | null {
  if (bytes.stream) return bytes.stream;
  if (!bytes.body) return null;
  return bytes.body.buffer.slice(bytes.body.byteOffset, bytes.body.byteOffset + bytes.body.byteLength) as ArrayBuffer;
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json() as unknown;
  } catch {
    return null;
  }
}
