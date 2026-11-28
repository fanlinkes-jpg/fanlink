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

/** Ancho máximo de una burbuja de texto y de una con medio (px). */
export const BUBBLE_MAX_PERCENT = 70;
export const BUBBLE_MEDIA_MAX_PX = 380;

export type PricePill = { money: string; state: "pagado" | "no pagado" | "sin datos"; label: string };

/** Pastilla del pie: precio y estado del PPV. Null si el mensaje no tiene precio. */
export function pricePill(message: { priceCents: number | null; purchased: boolean | null }): PricePill | null {
  if (message.priceCents == null || message.priceCents <= 0) return null;
  const money = `$${(message.priceCents / 100).toFixed(2)}`;
  if (message.purchased == null) return { money, state: "sin datos", label: "Sin datos" };
  return message.purchased
    ? { money, state: "pagado", label: "Pagado" }
    : { money, state: "no pagado", label: "No pagado" };
}

export type BubbleTag = { name: string | null; username: string | null };

/** Etiquetas de todos los medios del mensaje, sin repetir. */
export function mediaTags(media: ReadonlyArray<{ tags?: ReadonlyArray<BubbleTag> | null }> | null | undefined): BubbleTag[] {
  const seen = new Set<string>();
  const out: BubbleTag[] = [];
  for (const item of media ?? []) {
    for (const tag of item.tags ?? []) {
      const key = (tag.username ?? tag.name ?? "").toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(tag);
    }
  }
  return out;
}

/** Nombre a mostrar de una etiqueta: el nombre, o @usuario si no hay nombre. */
export function tagName(tag: BubbleTag): string {
  return tag.name?.trim() || (tag.username ? `@${tag.username.replace(/^@+/, "")}` : "");
}

/** «@ Etiquetas · Ana · Bea». Null si no hay etiquetas. La línea se trunca con CSS. */
export function tagLine(tags: readonly BubbleTag[]): string | null {
  const names = tags.map(tagName).filter(Boolean);
  if (names.length === 0) return null;
  return names.join(" · ");
}

export type BubbleText = { title: string | null; paragraphs: string[] };

/**
 * Párrafos del mensaje. En un mensaje con medio o precio, una primera línea corta
 * seguida de más texto es el título y va en negrita. En un mensaje normal no se inventa título.
 */
export function bubbleText(body: string, titled: boolean): BubbleText {
  const paragraphs = body.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  if (titled && paragraphs.length >= 2 && (paragraphs[0] as string).length <= 80) {
    return { title: paragraphs[0] as string, paragraphs: paragraphs.slice(1) };
  }
  return { title: null, paragraphs };
}

/** Checks del pie de un mensaje propio: leído, enviado o sin datos. */
export function readState(message: { fromFan: boolean; seen?: boolean | null }): "leido" | "enviado" | null {
  if (message.fromFan) return null;
  if (message.seen === true) return "leido";
  if (message.seen === false) return "enviado";
  return null;
}
