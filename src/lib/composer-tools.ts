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

export function authorLabel(name: string | null, automatic: boolean | null): string {
  if (automatic) return "Mensaje automático";
  if (!name) return "Cuenta";
  return name.toLocaleUpperCase("es-ES");
}

/** Colores del formato, en el orden de la paleta de OnlyFans. */
export const TEXT_COLORS = [
  { name: "Negro", hex: "#1c2333" },
  { name: "Rojo", hex: "#e11d48" },
  { name: "Naranja", hex: "#f97316" },
  { name: "Amarillo", hex: "#ca8a04" },
  { name: "Verde", hex: "#16a34a" },
  { name: "Azul", hex: "#2563eb" },
  { name: "Morado", hex: "#7c3aed" },
  { name: "Rosa", hex: "#db2777" },
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

/** Solo entran PPV de la creadora que constan como comprados. El resto no se dibuja. */
export function purchasedPpvSeries(messages: Array<{
  fromFan: boolean;
  purchased: boolean | null;
  priceCents: number | null;
  sentAt: string;
}>): { maxCents: number | null; avgCents: number | null; points: PpvPoint[] } {
  const points = messages
    .filter((message) => !message.fromFan && message.purchased === true && message.priceCents != null && message.priceCents > 0 && message.sentAt !== "")
    .map((message) => ({ sentAt: message.sentAt, priceCents: message.priceCents ?? 0 }))
    .sort((left, right) => left.sentAt.localeCompare(right.sentAt));
  if (points.length === 0) return { maxCents: null, avgCents: null, points: [] };
  const total = points.reduce((sum, point) => sum + point.priceCents, 0);
  return {
    maxCents: Math.max(...points.map((point) => point.priceCents)),
    avgCents: Math.round(total / points.length),
    points,
  };
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
