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
