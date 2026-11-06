export type MediaReader = {
  /** VITE_AUTH_ENABLED=false en localhost, sin base real. */
  localOpen: boolean;
  role: "owner" | "member" | null;
  perms: readonly string[];
  creatorId: string;
  threadKey: string;
  row: { creatorId: string; threadKey: string } | null;
};

/** La miniatura solo sale si el hilo es de esa creadora y la sesión puede ver el chat. */
export function canReadChatMedia(access: MediaReader): boolean {
  if (access.role !== "owner" && !access.perms.includes("mensajes")) return false;
  if (!access.row) return false;
  return access.row.creatorId === access.creatorId && access.row.threadKey === access.threadKey;
}

/** La ruta /api/chat-media responde 404 si faltan datos, no hay permiso o el hilo no es el de la fila. */
export function chatMediaRouteStatus(input: {
  creatorId: string;
  messageKey: string;
  threadKey: string;
  indexRaw: string | null;
  creatorAllowed: boolean;
  reader: MediaReader;
}): 200 | 404 {
  const index = Number(input.indexRaw ?? "");
  if (!input.creatorId || !input.messageKey || !input.threadKey || !Number.isInteger(index) || index < 0) return 404;
  if (!input.creatorAllowed || !canReadChatMedia(input.reader)) return 404;
  return 200;
}
