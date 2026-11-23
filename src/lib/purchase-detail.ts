export function purchaseComposeDraft(mode: "quick" | "reply", scripts: ReadonlyArray<{ body: string }>): { text: string; send: false } {
  const script = scripts.find((item) => item.body.trim() !== "");
  if (script) return { text: script.body, send: false };
  if (mode === "quick") return { text: "Gracias por tu compra", send: false };
  return { text: "", send: false };
}

export function purchaseTitle(body: string | null): string | null {
  const line = body?.split("\n").map((part) => part.trim()).find((part) => part.length > 0) ?? "";
  if (!line || line.length > 80) return null;
  return line;
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
