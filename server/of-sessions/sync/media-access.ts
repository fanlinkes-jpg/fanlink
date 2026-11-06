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
  if (!access.localOpen && access.role !== "owner" && !access.perms.includes("mensajes")) return false;
  if (!access.row) return false;
  return access.row.creatorId === access.creatorId && access.row.threadKey === access.threadKey;
}
