import { deliverChatSend, type DeliverSale } from "../send/deliver.ts";
import { deliverMassVault } from "../send/mass-vault.ts";
import { mediaHostAllowed } from "../sync/history.ts";
import { loadSaleContext } from "../sync/vault-store.ts";
import type { ReadSql } from "../sync/store.ts";
import { creatorAllowed, queryVaultForActor, type VaultActor } from "../sync/vault-query.ts";
import type { MassEnv } from "../../../src/lib/mass/gates.ts";
import type { MediaBytes } from "../sync/media-bytes.ts";

export type SessionActor = VaultActor | null;

export function mediaLogLine(creatorId: string, messageKey: string): string {
  const clean = (value: string) => value.replace(/https?:\/\/\S+/gi, "").replace(/\s+/g, " ").trim().slice(0, 80);
  return `[fanlink:media] creator=${clean(creatorId)} message=${clean(messageKey)}`;
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
  deps.log?.(mediaLogLine(creatorId, messageKey));
  if (!creatorId || !messageKey || !Number.isInteger(index) || index < 0) return new Response("Sin datos", { status: 404 });
  if (!creatorAllowed(actor, creatorId)) return new Response("Sin datos", { status: 403 });
  const row = await deps.findMedia(creatorId, threadKey, messageKey, index);
  return streamMedia(row?.url ?? null, request, deps.fetchBytes);
}

export async function handleVaultMedia(request: Request, deps: {
  session: () => Promise<SessionActor>;
  findPreview: (creatorId: string, mediaId: string, variant?: "full" | "preview") => Promise<string | null>;
  fetchBytes: (url: string, range?: string | null) => Promise<MediaBytes | null>;
  log?: (line: string) => void;
}): Promise<Response> {
  const actor = await deps.session();
  if (!actor) return new Response("Unauthorized", { status: 401 });
  if (!canReadMedia(actor)) return new Response("Forbidden", { status: 403 });
  const url = new URL(request.url);
  const creatorId = url.searchParams.get("creatorId") ?? "";
  const mediaId = url.searchParams.get("mediaId") ?? "";
  const variant = url.searchParams.get("variant") === "full" ? "full" : "preview";
  deps.log?.(mediaLogLine(creatorId, mediaId));
  if (!creatorId || !mediaId) return new Response("Sin datos", { status: 404 });
  if (!creatorAllowed(actor, creatorId)) return new Response("Sin datos", { status: 403 });
  const preview = await deps.findPreview(creatorId, mediaId, variant);
  return streamMedia(preview, request, deps.fetchBytes);
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
  request: Request,
  fetchBytes: (url: string, range?: string | null) => Promise<MediaBytes | null>,
): Promise<Response> {
  if (!target || !mediaHostAllowed(target)) return new Response("Sin datos", { status: 404 });
  const range = request.headers.get("range");
  const bytes = await fetchBytes(target, range);
  if (!bytes) return new Response("Sin datos", { status: 404 });
  const body = mediaBody(bytes);
  if (!body) return new Response("Sin datos", { status: 404 });
  const length = bytes.contentLength ?? bytes.body?.byteLength ?? null;
  const headers = new Headers({
    "content-type": bytes.contentType || "application/octet-stream",
    "cache-control": "private, no-store",
    "x-content-type-options": "nosniff",
    "accept-ranges": "bytes",
  });
  if (length != null) headers.set("content-length", String(length));
  if (bytes.contentRange) headers.set("content-range", bytes.contentRange);
  return new Response(body, { status: bytes.status, headers });
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
