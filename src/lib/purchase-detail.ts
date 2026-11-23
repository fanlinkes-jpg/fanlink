export function purchaseComposeDraft(mode: "quick" | "reply", scripts: ReadonlyArray<{ body: string }>): { text: string; send: false } {
  const script = scripts.find((item) => item.body.trim() !== "");
  if (script) return { text: script.body, send: false };
  if (mode === "quick") return { text: "Gracias por tu compra", send: false };
  return { text: "", send: false };
}

/** El título va en la cabecera. El texto de debajo no lo repite. */
export function purchaseHeading(body: string | null): { title: string; rest: string } {
  const raw = body ?? "";
  const lines = raw.split("\n");
  const index = lines.findIndex((line) => line.trim().length > 0);
  if (index < 0) return { title: "PPV", rest: "" };
  const title = lines[index]?.trim() || "PPV";
  const rest = lines.slice(index + 1).join("\n").trim();
  return { title, rest };
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
