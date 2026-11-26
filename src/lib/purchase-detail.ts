export function purchaseComposeDraft(mode: "quick" | "reply", scripts: ReadonlyArray<{ body: string }>): { text: string; send: false } {
  const script = scripts.find((item) => item.body.trim() !== "");
  if (script) return { text: script.body, send: false };
  if (mode === "quick") return { text: "Gracias por tu compra", send: false };
  return { text: "", send: false };
}

/** La cabecera del modal es corta; el texto del mensaje va debajo. */
export function purchaseHeading(body: string | null): { title: string; rest: string } {
  const raw = (body ?? "").trim();
  if (!raw) return { title: "PPV", rest: "" };
  return { title: "PPV", rest: raw };
}

export function purchaseDetailModel(input: { creatorName: string; priceCents: number | null; title?: string | null }): {
  title: string;
  price: string;
  tags: string;
  sends: false;
} {
  const price = input.priceCents == null ? "Sin datos" : `$${(input.priceCents / 100).toFixed(2)}`;
  return {
    title: input.title?.trim() || "PPV",
    price,
    tags: `Tags • ${input.creatorName.trim() || "Cuenta"}`,
    sends: false,
  };
}
