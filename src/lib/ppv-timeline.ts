/** Un medio del PPV: tipo, duración, miniatura y si sigue con candado. */
export type PpvMedia = { kind: "foto" | "video" | "audio" | null; seconds: number | null; preview: string | null; locked: boolean | null };

export const PPV_MEDIA_MAX = 12;

export type PpvSource = {
  messageKey: string;
  body: string;
  sentAt: string;
  fromFan: boolean;
  priceCents: number | null;
  purchased: boolean | null;
  mediaCount?: number | null;
  mediaSeconds?: number | null;
  mediaPreview?: string | null;
  media?: ReadonlyArray<{ kind?: PpvMedia["kind"]; seconds?: number | null; preview?: string | null; locked?: boolean | null }> | null;
};

export type PpvRow = {
  messageKey: string;
  body: string;
  sentAt: string;
  price: string;
  priceCents: number;
  state: "comprado" | "no comprado" | "Sin datos";
  media: string;
  preview: string | null;
  /** Todos los medios del PPV, en el orden del mensaje. Vacío si no se guardaron. */
  items: PpvMedia[];
};

/** Mensajes cargados en pantalla más los PPV guardados del hilo. Gana el cargado si la clave se repite. */
export function mergePpvSources(loaded: PpvSource[], stored: PpvSource[] | null | undefined): PpvSource[] {
  const keys = new Set(loaded.map((message) => message.messageKey));
  return [...loaded, ...(stored ?? []).filter((message) => !keys.has(message.messageKey))];
}

export type PurchasePoint = { sentAt: string; priceCents: number };

/**
 * Solo cuenta un PPV si el mensaje trae precio.
 * Con `purchases` (compras guardadas de todo el hilo) un PPV sin marca de pago consta como comprado
 * si hay una compra del mismo importe posterior a su envío (cada compra se usa una vez),
 * y si no hay ninguna es «no comprado». Una compra sin mensaje en el historial cargado
 * entra como fila propia. Sin `purchases` el estado no se inventa.
 */
export function ppvTimeline(messages: PpvSource[], purchases?: readonly PurchasePoint[] | null): { rate: string; high: string; low: string; rows: PpvRow[] } {
  const own = messages
    .filter((message) => !message.fromFan && message.priceCents != null && message.priceCents > 0)
    .sort((left, right) => right.sentAt.localeCompare(left.sentAt));
  const paid = new Set<string>();
  const loose: PurchasePoint[] = [];
  if (purchases) {
    const sorted = [...purchases].filter((row) => row.priceCents > 0 && row.sentAt !== "").sort((l, r) => l.sentAt.localeCompare(r.sentAt));
    for (const purchase of sorted) {
      const fits = own.filter((message) => !paid.has(message.messageKey) && message.priceCents === purchase.priceCents && message.sentAt <= purchase.sentAt);
      // `own` va de más nuevo a más viejo: el primero es el último PPV enviado antes de la compra.
      const hit = fits.find((message) => message.purchased === true) ?? fits[0];
      if (hit) paid.add(hit.messageKey);
      else loose.push(purchase);
    }
  }
  const rows: PpvRow[] = own.map((message) => ({
    messageKey: message.messageKey,
    body: message.body,
    sentAt: message.sentAt,
    price: money(message.priceCents ?? 0),
    priceCents: message.priceCents ?? 0,
    state: message.purchased === true || paid.has(message.messageKey)
      ? "comprado" as const
      : message.purchased === false || purchases ? "no comprado" as const : "Sin datos" as const,
    media: mediaLabel(message.mediaCount, message.mediaSeconds),
    preview: message.mediaPreview ?? null,
    items: mediaItems(message),
  }));
  for (const purchase of loose) {
    rows.push({
      messageKey: `compra:${purchase.sentAt}:${purchase.priceCents}`,
      body: "",
      sentAt: purchase.sentAt,
      price: money(purchase.priceCents),
      priceCents: purchase.priceCents,
      state: "comprado",
      media: "Sin datos",
      preview: null,
      items: [],
    });
  }
  rows.sort((left, right) => right.sentAt.localeCompare(left.sentAt));
  const known = rows.filter((row) => row.state !== "Sin datos");
  const bought = known.filter((row) => row.state === "comprado").length;
  const prices = rows.map((row) => row.priceCents);
  return {
    rate: known.length === 0 ? "Sin datos" : `${bought}/${known.length} (${Math.round((bought / known.length) * 100)}%)`,
    high: prices.length === 0 ? "Sin datos" : money(Math.max(...prices)),
    low: prices.length === 0 ? "Sin datos" : money(Math.min(...prices)),
    rows,
  };
}

function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function mediaLabel(count: number | null | undefined, seconds: number | null | undefined): string {
  if (count == null) return "Sin datos";
  const length = seconds == null ? "" : ` · ${seconds}s`;
  return `${count} medios${length}`;
}

/** Medios del mensaje para la fila. Si solo hay miniatura suelta, es un medio. */
export function mediaItems(message: Pick<PpvSource, "media" | "mediaPreview" | "mediaCount" | "mediaSeconds">): PpvMedia[] {
  const list = (message.media ?? []).slice(0, PPV_MEDIA_MAX).map((item) => ({
    kind: item.kind ?? null,
    seconds: item.seconds ?? null,
    preview: item.preview ?? null,
    locked: item.locked ?? null,
  }));
  if (list.length > 0) return list;
  if (message.mediaPreview) return [{ kind: null, seconds: message.mediaSeconds ?? null, preview: message.mediaPreview, locked: null }];
  return [];
}

/** 0:12 · 1:05:09 */
export function clipLabel(seconds: number | null | undefined): string | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return null;
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = String(total % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
}

/** Etiqueta de la fecha del PPV, como Infloww: Oct 16, 2026 (hora de Madrid). */
export function ppvDateLabel(iso: string): string {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return "Sin datos";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "Europe/Madrid" }).format(new Date(time));
}
