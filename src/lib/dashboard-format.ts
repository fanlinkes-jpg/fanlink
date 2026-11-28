import { formatCents } from "./format.ts";
import { SIN_DATOS } from "./dashboard-config.ts";
import { CREATOR_COLUMNS, type CreatorColumnId } from "./dashboard-insights.ts";

export type ValueKind = "money" | "ratio" | "number" | "minutes";

export function formatValue(kind: ValueKind, value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return SIN_DATOS;
  switch (kind) {
    case "money":
      return formatCents(value);
    case "ratio":
      return `${(value * 100).toFixed(1).replace(".", ",")} %`;
    case "minutes":
      return value < 60 ? `${Math.round(value)} min` : `${Math.floor(value / 60)} h ${Math.round(value % 60)} min`;
    case "number":
      return new Intl.NumberFormat("es-ES").format(Math.round(value * 10) / 10);
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

/** «+12,5 %», «−3,0 %» o vacío si no hay periodo anterior. */
export function changeText(change: number | null | undefined): string {
  if (change == null || !Number.isFinite(change)) return "";
  const sign = change > 0 ? "+" : change < 0 ? "−" : "";
  return `${sign}${Math.abs(change * 100).toFixed(1).replace(".", ",")} %`;
}

export function columnKind(id: CreatorColumnId): ValueKind {
  if (id === "replyMinutes") return "minutes";
  return CREATOR_COLUMNS.find((column) => column.id === id)?.kind ?? "number";
}

export function columnLabel(id: CreatorColumnId): string {
  return CREATOR_COLUMNS.find((column) => column.id === id)?.label ?? id;
}

/** Columnas guardadas: válidas, sin repetir y en el orden elegido. */
export function readColumns(raw: unknown, fallback: readonly CreatorColumnId[]): CreatorColumnId[] {
  if (!Array.isArray(raw)) return [...fallback];
  const valid = new Set<string>(CREATOR_COLUMNS.map((column) => column.id));
  const picked = [...new Set(raw.filter((item): item is CreatorColumnId => typeof item === "string" && valid.has(item)))];
  return picked.length > 0 ? picked : [...fallback];
}

export function moveColumn(columns: readonly CreatorColumnId[], id: CreatorColumnId, delta: -1 | 1): CreatorColumnId[] {
  const next = [...columns];
  const index = next.indexOf(id);
  const target = index + delta;
  if (index < 0 || target < 0 || target >= next.length) return next;
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}

/** CSV con «;» (Excel en español) y comillas cuando hace falta. */
export function toCsv(header: string[], rows: Array<Array<string | number | null>>): string {
  const cell = (value: string | number | null) => {
    if (value == null) return "";
    const text = String(value);
    return /[;"\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [header, ...rows].map((row) => row.map(cell).join(";")).join("\n");
}

/** Céntimos a «123,45» para el CSV. */
export function csvMoney(cents: number | null | undefined): string | null {
  if (cents == null) return null;
  return (cents / 100).toFixed(2).replace(".", ",");
}

export const WEEKDAY_SHORT = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"] as const;

export function greeting(now: Date, name: string): string {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Madrid", hour: "2-digit", hourCycle: "h23" }).format(now));
  const word = hour < 6 ? "Buenas noches" : hour < 14 ? "Buenos días" : hour < 21 ? "Buenas tardes" : "Buenas noches";
  const first = name.trim().split(/\s+/)[0] ?? "";
  return first ? `${word}, ${first}` : word;
}
