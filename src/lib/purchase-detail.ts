export function purchaseComposeDraft(mode: "quick" | "reply", scripts: ReadonlyArray<{ body: string }>): { text: string; send: false } {
  const script = scripts.find((item) => item.body.trim() !== "");
  if (script) return { text: script.body, send: false };
  if (mode === "quick") return { text: "Gracias por tu compra", send: false };
  return { text: "", send: false };
}

export function purchaseDetailModel(input: { creatorName: string; priceCents: number | null }): {
  title: string;
  price: string;
  tags: string;
  sends: false;
} {
  const price = input.priceCents == null ? "Sin datos" : `$${(input.priceCents / 100).toFixed(2)}`;
  return {
    title: "PPV",
    price,
    tags: `Tags • ${input.creatorName.trim() || "Cuenta"}`,
    sends: false,
  };
}
