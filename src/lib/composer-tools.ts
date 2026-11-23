/** Emojis rápidos del compositor. Se cambian aquí, no en la pantalla. */
export const QUICK_EMOJIS = [
  "🥰", "🤭", "😏", "😮", "😲", "🙈", "👄", "💗", "💋", "🍑", "🍆", "💦",
  "😈", "😅", "🫣", "🫢", "🤫", "👅", "🔥", "😘", "🚨", "👙", "📲", "📞",
  "👀", "⏰", "😀", "☎️", "💉", "🎬", "📽️", "🎥", "🥺", "🐰", "⚽", "🥳",
  "❤️", "👻",
];

/** Selector completo. También se cambia aquí. */
export const FULL_EMOJIS = [
  ...QUICK_EMOJIS,
  "😂", "😊", "😉", "😍", "😭", "😡", "👍", "🙏", "💯", "✨", "🎉", "🌹",
  "🍓", "🍒", "💃", "🕺", "💌", "💎", "🌙", "⭐", "🌈", "🍀",
];

/** Un PPV de pago con medios y sin vista previa gratis no puede salir. */
export function ppvPreviewMissing(priceCents: number | null, mediaCount: number, previewCount: number): boolean {
  return priceCents != null && priceCents > 0 && mediaCount > 0 && previewCount === 0;
}

export function emojiRows(emojis: string[], perRow = 12): string[][] {
  const rows: string[][] = [];
  for (let index = 0; index < emojis.length; index += perRow) rows.push(emojis.slice(index, index + perRow));
  return rows;
}

export type ScriptHit = { id: string; title: string; keyword: string; text: string; priceCents: number | null };

export function matchScripts(
  scripts: Array<{ id: string; title: string; keyword: string; steps: Array<{ text: string; price?: number }> }>,
  query: string,
): ScriptHit[] {
  const needle = query.trim().toLowerCase();
  return scripts.flatMap((script) => {
    const step = script.steps[0];
    if (!step?.text.trim()) return [];
    if (needle && !script.keyword.toLowerCase().includes(needle) && !script.title.toLowerCase().includes(needle)) return [];
    return [{
      id: script.id,
      title: script.title,
      keyword: script.keyword,
      text: step.text,
      priceCents: step.price == null ? null : Math.round(step.price * 100),
    }];
  });
}

/** La palabra que sigue a / al final del borrador. Null si no hay atajo. */
export function slashQuery(draft: string): string | null {
  const match = draft.match(/(?:^|\s)\/(\S*)$/);
  return match ? match[1] ?? "" : null;
}

export function wrapSelection(value: string, start: number, end: number, marker: string): { value: string; cursor: number } {
  const selected = value.slice(start, end) || "texto";
  const next = `${value.slice(0, start)}${marker}${selected}${marker}${value.slice(end)}`;
  return { value: next, cursor: start + marker.length + selected.length + marker.length };
}

export function mentionToken(handle: string | null): string {
  if (!handle) return "@";
  return `@${handle.replace(/^@/, "")} `;
}

export function paymentLabel(message: { fromFan: boolean; priceCents: number | null; purchased: boolean | null }): string | null {
  if (message.fromFan || message.priceCents == null || message.priceCents <= 0) return null;
  const money = `$${(message.priceCents / 100).toFixed(2)}`;
  if (message.purchased == null) return `${money} · Sin datos`;
  return message.purchased ? `${money} pagado` : `${money} no pagado`;
}

/** Como Infloww: el nombre en su caja, junto a la hora. No se pasa a mayúsculas. */
export function authorLabel(name: string | null, automatic: boolean | null): string {
  if (automatic) return "Mensaje automático";
  const clean = name?.replace(/\s+/g, " ").trim() ?? "";
  if (!clean) return "Cuenta";
  return clean;
}

/**
 * Los tres colores de texto que documenta OnlyFans para el editor
 * (clases m-editor-fc__gray, m-editor-fc__blue-1 y m-editor-fc__blue-2).
 */
export const TEXT_COLORS = [
  { name: "Gris", hex: "#8a96a3", ofClass: "m-editor-fc__gray" },
  { name: "Azul", hex: "#00aff0", ofClass: "m-editor-fc__blue-1" },
  { name: "Azul 2", hex: "#1b98e0", ofClass: "m-editor-fc__blue-2" },
] as const;

export type MessagePrice = { ok: true; cents: number | null } | { ok: false };

/** Vacío o «Gratis» es gratis. Cualquier importe por debajo de 3 USD no vale. */
export function messagePriceCents(raw: string): MessagePrice {
  const text = raw.trim().toLowerCase().replace(/^\$/, "").replace(/\s/g, "").replace(",", ".");
  if (text === "" || text === "gratis" || text === "0" || text === "0.0" || text === "0.00") {
    return { ok: true, cents: null };
  }
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return { ok: false };
  const dollars = Number(text);
  if (!Number.isFinite(dollars) || dollars < 0) return { ok: false };
  if (dollars > 0 && dollars < 3) return { ok: false };
  if (dollars === 0) return { ok: true, cents: null };
  return { ok: true, cents: Math.round(dollars * 100) };
}

export type PpvPoint = { sentAt: string; priceCents: number };

export type PaidSource = { sentAt: string; priceCents: number };

/**
 * PPV comprados. Un mensaje propio solo entra si consta como pagado.
 * Avisos de compra y movimientos de mensaje entran aunque `isOpened` sea falso.
 * El mismo día y el mismo importe no se cuentan dos veces.
 */
export function purchasedPpvSeries(
  messages: Array<{
    fromFan: boolean;
    purchased: boolean | null;
    priceCents: number | null;
    sentAt: string;
  }>,
  sources: readonly (readonly PaidSource[])[] = [],
): { maxCents: number | null; avgCents: number | null; points: PpvPoint[] } {
  const fromChat = messages
    .filter((message) => !message.fromFan && message.purchased === true && message.priceCents != null && message.priceCents > 0 && message.sentAt !== "")
    .map((message) => ({ sentAt: message.sentAt, priceCents: message.priceCents ?? 0 }));
  const points = mergePaidPoints([fromChat, ...sources.map((rows) => rows.filter((row) => row.priceCents > 0 && row.sentAt !== ""))]);
  if (points.length === 0) return { maxCents: null, avgCents: null, points: [] };
  const total = points.reduce((sum, point) => sum + point.priceCents, 0);
  return {
    maxCents: Math.max(...points.map((point) => point.priceCents)),
    avgCents: Math.round(total / points.length),
    points,
  };
}

function mergePaidPoints(sources: PaidSource[][]): PpvPoint[] {
  const groups = sources.map(tallyPaid);
  const keys = new Set(groups.flatMap((group) => [...group.keys()]));
  const points: PpvPoint[] = [];
  for (const key of keys) {
    let count = 0;
    let point: PpvPoint | null = null;
    for (const group of groups) {
      const row = group.get(key);
      if (row && row.count > count) {
        count = row.count;
        point = row.point;
      }
    }
    if (!point) continue;
    for (let index = 0; index < count; index += 1) points.push(point);
  }
  return points.sort((left, right) => left.sentAt.localeCompare(right.sentAt));
}

function tallyPaid(rows: PaidSource[]): Map<string, { count: number; point: PpvPoint }> {
  const grouped = new Map<string, { count: number; point: PpvPoint }>();
  for (const row of rows) {
    const key = `${row.sentAt.slice(0, 10)}:${row.priceCents}`;
    const prev = grouped.get(key);
    if (!prev) grouped.set(key, { count: 1, point: { sentAt: row.sentAt, priceCents: row.priceCents } });
    else prev.count += 1;
  }
  return grouped;
}

export function moneyLabel(cents: number | null): string {
  if (cents == null) return "Sin datos";
  return `$${(cents / 100).toFixed(2)}`;
}

export function priceChartLayout(
  points: PpvPoint[],
  width: number,
  height: number,
): Array<{ x: number; y: number; label: string; date: string }> {
  if (points.length === 0 || width <= 0 || height <= 0) return [];
  const padX = 28;
  const padY = 18;
  const max = Math.max(...points.map((point) => point.priceCents));
  const min = Math.min(...points.map((point) => point.priceCents));
  const span = max - min;
  return points.map((point, index) => {
    const x = points.length === 1 ? width / 2 : padX + (index * (width - padX * 2)) / (points.length - 1);
    const y = span === 0 ? height / 2 : height - padY - ((point.priceCents - min) / span) * (height - padY * 2);
    const whole = point.priceCents % 100 === 0;
    return {
      x,
      y,
      label: `$${(point.priceCents / 100).toFixed(whole ? 0 : 2)}`,
      date: shortDate(point.sentAt),
    };
  });
}

function shortDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${day}/${month}`;
}
