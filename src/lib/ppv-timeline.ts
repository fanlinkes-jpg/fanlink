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
