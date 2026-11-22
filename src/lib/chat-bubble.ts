export type BubbleLayout = "none" | "single" | "carousel";
export type BubbleBlock = "media" | "price" | "text";

/**
 * Un medio se queda suelto. Varios van en carrusel, también si el mensaje
 * salió de la cola de masivos o lo recibió la cuenta de otra creadora.
 * El precio va debajo del medio y encima del texto.
 */
export function bubbleBlocks(input: {
  mediaCount: number;
  priceCents: number | null;
  body: string;
}): { layout: BubbleLayout; blocks: BubbleBlock[] } {
  const layout: BubbleLayout = input.mediaCount > 1 ? "carousel" : input.mediaCount === 1 ? "single" : "none";
  const blocks: BubbleBlock[] = [];
  if (layout !== "none") blocks.push("media");
  if (input.priceCents != null && input.priceCents > 0) blocks.push("price");
  if (input.body.trim()) blocks.push("text");
  return { layout, blocks };
}

/** Precio y pagado/no pagado, lo envíe la cuenta, un fan u otra creadora. */
export function bubblePriceLabel(message: { priceCents: number | null; purchased: boolean | null }): string | null {
  if (message.priceCents == null || message.priceCents <= 0) return null;
  const money = `$${(message.priceCents / 100).toFixed(2)}`;
  if (message.purchased == null) return `${money} · Sin datos`;
  return message.purchased ? `${money} pagado` : `${money} no pagado`;
}
