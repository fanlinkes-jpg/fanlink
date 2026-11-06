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

/** Solo cuenta un PPV si el mensaje trae precio. El estado de compra no se inventa. */
export function ppvTimeline(messages: PpvSource[]): { rate: string; high: string; low: string; rows: PpvRow[] } {
  const rows = messages
    .filter((message) => !message.fromFan && message.priceCents != null && message.priceCents > 0)
    .sort((left, right) => right.sentAt.localeCompare(left.sentAt))
    .map((message) => ({
      messageKey: message.messageKey,
      body: message.body,
      sentAt: message.sentAt,
      price: money(message.priceCents ?? 0),
      priceCents: message.priceCents ?? 0,
      state: message.purchased == null ? "Sin datos" as const : message.purchased ? "comprado" as const : "no comprado" as const,
      media: mediaLabel(message.mediaCount, message.mediaSeconds),
      preview: message.mediaPreview ?? null,
    }));
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
