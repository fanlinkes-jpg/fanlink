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

export function vaultMediaSrc(creatorId: string, mediaId: string, variant: "full" | "preview" = "preview"): string {
  const params = new URLSearchParams({ creatorId, mediaId, variant });
  return `/api/vault-media?${params.toString()}`;
}
