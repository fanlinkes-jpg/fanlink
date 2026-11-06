import { canReadChatMedia, chatMediaRouteStatus } from "./media-access.ts";

export type ChatMediaDeps = {
  localOpen: boolean;
  role: "owner" | "member" | null;
  perms: readonly string[];
  creatorAllowed: (creatorId: string) => boolean;
  findRow: (creatorId: string, messageKey: string) => Promise<{ threadKey: string } | null>;
  loadThumb: (creatorId: string, messageKey: string, threadKey: string, index: number) => Promise<Uint8Array | null>;
  openFull: (
    request: Request,
    creatorId: string,
    messageKey: string,
    threadKey: string,
    index: number,
    variant: string,
    segmentUrl: string | null,
  ) => Promise<Response>;
};

/** Misma decisión que /api/chat-media. 404 si no hay permiso o el hilo no es el de la fila. */
export async function serveChatMedia(request: Request, deps: ChatMediaDeps): Promise<Response> {
  const url = new URL(request.url);
  const creatorId = url.searchParams.get("creatorId") ?? "";
  const messageKey = url.searchParams.get("messageKey") ?? "";
  const threadKey = url.searchParams.get("threadKey") ?? "";
  const indexRaw = url.searchParams.get("index");
  const index = Number(indexRaw ?? "");
  const row = creatorId && messageKey ? await deps.findRow(creatorId, messageKey) : null;
  // media-access.ts es el del hilo: sin permiso mensajes solo pasa el owner.
  // Con el login local apagado, un miembro también ve la miniatura.
  const reader = {
    localOpen: deps.localOpen,
    role: deps.localOpen ? "owner" as const : deps.role,
    perms: deps.perms,
    creatorId,
    threadKey,
    row: row ? { creatorId, threadKey: row.threadKey } : null,
  };
  const status = chatMediaRouteStatus({
    creatorId,
    messageKey,
    threadKey,
    indexRaw,
    creatorAllowed: creatorId ? deps.creatorAllowed(creatorId) : false,
    reader,
  });
  if (status === 404 || !canReadChatMedia(reader)) return new Response("Sin datos", { status: 404 });
  const variant = url.searchParams.get("variant") ?? "thumb";
  if (variant === "full" || variant === "segment") {
    return deps.openFull(request, creatorId, messageKey, threadKey, index, variant, url.searchParams.get("u"));
  }
  const bytes = await deps.loadThumb(creatorId, messageKey, threadKey, index);
  if (!bytes) return new Response("Sin datos", { status: 404 });
  return new Response(Buffer.from(bytes), { headers: { "content-type": sniff(bytes), "cache-control": "private, max-age=86400" } });
}

function sniff(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return "image/png";
  if (bytes[0] === 0x47 && bytes[1] === 0x49) return "image/gif";
  return "application/octet-stream";
}
