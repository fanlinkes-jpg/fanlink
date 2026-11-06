import { TEXT_MARKS, type TextMark, type TextRun } from "./types.ts";

const MARKERS: Record<string, TextMark> = {
  "*": "bold",
  _: "italic",
  "+": "underline",
  "~": "strike",
};

export function parseMarkup(source: string): TextRun[] {
  const runs: TextRun[] = [];
  let plain = "";
  for (let index = 0; index < source.length; index += 1) {
    const marker = source[index] ?? "";
    const mark = MARKERS[marker];
    if (!mark) {
      plain += marker;
      continue;
    }
    const close = source.indexOf(marker, index + 1);
    if (close <= index + 1) {
      plain += marker;
      continue;
    }
    if (plain) {
      runs.push({ text: plain });
      plain = "";
    }
    runs.push({ text: source.slice(index + 1, close), marks: [mark] });
    index = close;
  }
  if (plain) runs.push({ text: plain });
  return runs.length > 0 ? runs : [{ text: "" }];
}

export function plainText(runs: readonly TextRun[]): string {
  return runs.map((run) => run.text).join("");
}

export function formattedText(runs: readonly TextRun[]): string {
  return runs
    .map((run) =>
      (run.marks ?? []).reduce((text, mark) => wrap(mark, text), run.text),
    )
    .join("");
}

export function personalize(
  runs: readonly TextRun[],
  fan: { name: string | null; handle: string | null },
): { runs: TextRun[]; gaps: string[] } {
  const gaps: string[] = [];
  const next = runs.map((run) => ({ ...run, text: fill(run.text, fan, gaps) }));
  return { runs: next, gaps };
}

export function knownMark(value: string): value is TextMark {
  return (TEXT_MARKS as readonly string[]).includes(value);
}

function fill(
  text: string,
  fan: { name: string | null; handle: string | null },
  gaps: string[],
): string {
  let out = text;
  if (out.includes("{nombrecompleto}")) {
    if (fan.name) out = out.replaceAll("{nombrecompleto}", fan.name);
    else if (!gaps.includes("nombre")) gaps.push("nombre");
  }
  if (out.includes("{nombre}")) {
    const first = fan.name?.split(" ")[0];
    if (first) out = out.replaceAll("{nombre}", first);
    else if (!gaps.includes("nombre")) gaps.push("nombre");
  }
  if (out.includes("{usuario}")) {
    if (fan.handle) out = out.replaceAll("{usuario}", fan.handle);
    else if (!gaps.includes("usuario")) gaps.push("usuario");
  }
  return out;
}

function wrap(mark: TextMark, text: string): string {
  switch (mark) {
    case "bold":
      return `*${text}*`;
    case "italic":
      return `_${text}_`;
    case "underline":
      return `+${text}+`;
    case "strike":
      return `~${text}~`;
    default: {
      const exhaustive: never = mark;
      throw new Error(`Marca no cubierta: ${String(exhaustive)}`);
    }
  }
}
