export function purchaseComposeDraft(mode: "quick" | "reply", scripts: ReadonlyArray<{ body: string }>): { text: string; send: false } {
  const script = scripts.find((item) => item.body.trim() !== "");
  if (script) return { text: script.body, send: false };
  if (mode === "quick") return { text: "Gracias por tu compra", send: false };
  return { text: "", send: false };
}

export function paidMessageTitle(priceCents: number | null | undefined): string {
  const base = "Mensaje de pago";
  if (priceCents == null || priceCents <= 0) return base;
  return `${base} · $${(priceCents / 100).toFixed(2)}`;
}

const TITLE_CHAR_LIMIT = 60;

/** La cabecera del modal es corta; el texto del mensaje va debajo. */
export function purchaseHeading(body: string | null, priceCents?: number | null): { title: string; rest: string } {
  const raw = (body ?? "").trim();
  if (!raw) return { title: paidMessageTitle(priceCents), rest: "" };
  const newline = raw.indexOf("\n");
  if (newline >= 0) {
    const title = raw.slice(0, newline).trim();
    const rest = raw.slice(newline + 1).trim();
    if (title) return { title, rest };
  }
  const sentence = raw.match(/^(.{1,220}?)([.!?…]|[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}])\s*(.*)/su);
  if (sentence) {
    const title = `${sentence[1] ?? ""}${sentence[2] ?? ""}`.trim();
    const rest = (sentence[3] ?? "").trim();
    if (title.length <= TITLE_CHAR_LIMIT) return { title, rest };
  }
  if (raw.length <= TITLE_CHAR_LIMIT) return { title: raw, rest: "" };
  const slice = raw.slice(0, TITLE_CHAR_LIMIT);
  const lastSpace = slice.lastIndexOf(" ");
  const title = (lastSpace > 20 ? slice.slice(0, lastSpace) : slice).trim();
  const rest = raw.slice(title.length).trim();
  return { title: title || raw.slice(0, TITLE_CHAR_LIMIT), rest };
}

export function purchaseDetailModel(input: { creatorName: string; priceCents: number | null; title?: string | null }): {
  title: string;
  price: string;
  tags: string;
  sends: false;
} {
  const price = input.priceCents == null ? "Sin datos" : `$${(input.priceCents / 100).toFixed(2)}`;
  return {
    title: input.title?.trim() || paidMessageTitle(input.priceCents),
    price,
    tags: `Tags • ${input.creatorName.trim() || "Cuenta"}`,
    sends: false,
  };
}