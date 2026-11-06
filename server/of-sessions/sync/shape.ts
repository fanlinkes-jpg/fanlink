/** Resumen de forma, sin valores. Sirve para ajustar el lector con un solo log. */
export function shapeSummary(value: unknown): string {
  return summarize(value).slice(0, 500);
}

export function logUnparsed(channel: "lectura" | "chat", section: string, outcome: "ok" | "empty" | "changed" | "pending", shape: string | null): void {
  if (outcome !== "changed" || !shape) return;
  console.info(`[fanlink:${channel}] forma ${section} ${shape}`);
}

function summarize(value: unknown): string {
  if (value === null) return "tipo=null";
  if (Array.isArray(value)) return `tipo=${arrayShape(value)}`.replace("tipo=array:", "tipo=array longitud=").replace(" item=", " item=");
  if (typeof value !== "object") return `tipo=${typeof value}`;
  const record = value as Record<string, unknown>;
  const parts = Object.keys(record).slice(0, 16).map((key) => {
    const child = record[key];
    if (Array.isArray(child)) return `${key}=${arrayShape(child)}`;
    if (child && typeof child === "object") return `${key}=object`;
    return `${key}=${child === null ? "null" : typeof child}`;
  });
  return `tipo=object claves=${parts.join(" ")}`;
}

function arrayShape(value: unknown[]): string {
  const first = value.find((item) => item && typeof item === "object" && !Array.isArray(item)) as Record<string, unknown> | undefined;
  const keys = first ? Object.keys(first).slice(0, 12).join(",") : "";
  return `array:${value.length}${keys ? ` item=${keys}` : ""}`;
}
