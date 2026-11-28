export type GalleryMessage = {
  messageKey: string;
  sentAt: string;
  fromFan?: boolean;
  priceCents: number | null;
  mediaPreview?: string | null;
  mediaSeconds?: number | null;
  mediaCount?: number | null;
  media?: ReadonlyArray<{
    kind?: "foto" | "video" | "audio" | null;
    seconds?: number | null;
    preview?: string | null;
    locked?: boolean | null;
    priceCents?: number | null;
  }> | null;
};

export type GalleryItem = {
  id: string;
  messageKey: string;
  sentAt: string;
  kind: "foto" | "video" | "audio" | null;
  preview: string | null;
  seconds: number | null;
  /** De pago: el mensaje trae precio. Si no, gratis. */
  paid: boolean;
  locked: boolean | null;
  fromFan: boolean;
};

export type GalleryFilter = { kind: "todos" | "foto" | "video"; pay: "todos" | "pagado" | "gratis" };

export const GALLERY_MAX_ITEMS = 600;

/** Todos los medios de la conversación, del más nuevo al más viejo. Sin inventar medios que no se guardaron. */
export function galleryItems(messages: readonly GalleryMessage[]): GalleryItem[] {
  const items: GalleryItem[] = [];
  for (const message of messages) {
    const paid = message.priceCents != null && message.priceCents > 0;
    const list = message.media ?? [];
    if (list.length > 0) {
      list.forEach((media, index) => {
        items.push({
          id: `${message.messageKey}:${index}`,
          messageKey: message.messageKey,
          sentAt: message.sentAt,
          kind: media.kind ?? null,
          preview: media.preview ?? null,
          seconds: media.seconds ?? null,
          paid: paid || (media.priceCents != null && media.priceCents > 0),
          locked: media.locked ?? null,
          fromFan: message.fromFan === true,
        });
      });
    } else if (message.mediaPreview) {
      items.push({
        id: `${message.messageKey}:0`,
        messageKey: message.messageKey,
        sentAt: message.sentAt,
        kind: null,
        preview: message.mediaPreview,
        seconds: message.mediaSeconds ?? null,
        paid,
        locked: null,
        fromFan: message.fromFan === true,
      });
    }
  }
  return items.sort((left, right) => right.sentAt.localeCompare(left.sentAt)).slice(0, GALLERY_MAX_ITEMS);
}

export function filterGallery(items: readonly GalleryItem[], filter: GalleryFilter): GalleryItem[] {
  return items.filter((item) => {
    if (filter.kind !== "todos" && item.kind !== filter.kind) return false;
    if (filter.pay === "pagado" && !item.paid) return false;
    if (filter.pay === "gratis" && item.paid) return false;
    return true;
  });
}

export function galleryCounts(items: readonly GalleryItem[]): { total: number; fotos: number; videos: number; pagados: number; gratis: number } {
  return {
    total: items.length,
    fotos: items.filter((item) => item.kind === "foto").length,
    videos: items.filter((item) => item.kind === "video").length,
    pagados: items.filter((item) => item.paid).length,
    gratis: items.filter((item) => !item.paid).length,
  };
}
