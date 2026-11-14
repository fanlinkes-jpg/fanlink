/** Lo que se pinta cuando el CDN no deja la miniatura. Nunca es una URL. */
export const VAULT_THUMB_MISSING = "Sin miniatura";

/** URL del proxy autenticado. Nunca es una URL del CDN. */
export function chatMediaSrc(input: { creatorId: string; threadKey: string; messageKey: string; index: number; variant?: "full" | "preview" }): string {
  const params = new URLSearchParams({
    creatorId: input.creatorId,
    threadKey: input.threadKey,
    messageKey: input.messageKey,
    index: String(input.index),
    variant: input.variant ?? "full",
  });
  return `/api/chat-media?${params.toString()}`;
}

export function vaultMediaSrc(
  creatorId: string,
  mediaId: string,
  variant: "full" | "preview" = "preview",
  page?: { list?: string | null; offset?: number | null },
): string {
  const params = new URLSearchParams({ creatorId, mediaId, variant });
  const list = page?.list?.trim();
  if (list) params.set("list", list.slice(0, 80));
  if (page?.offset != null && Number.isFinite(page.offset) && page.offset > 0) {
    params.set("offset", String(Math.min(2_000, Math.floor(page.offset))));
  }
  return `/api/vault-media?${params.toString()}`;
}
