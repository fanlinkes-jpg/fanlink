/**
 * Inicial de un nombre para el círculo del avatar. `slice(0, 1)` corta un emoji o un carácter fuera del plano
 * básico por la mitad (un surrogate suelto sale como «�»), así que se trabaja con grafemas completos:
 * la primera letra o cifra y, si no hay, el primer grafema entero. Sin nombre, «?».
 */
export function initialOf(name: string | null | undefined): string {
  const clean = (name ?? "").normalize("NFC").trim();
  if (!clean) return "?";
  const graphemes = splitGraphemes(clean);
  const letter = graphemes.find((item) => /[\p{L}\p{N}]/u.test(item));
  const pick = letter ?? graphemes[0] ?? "?";
  return pick.toLocaleUpperCase("es");
}

function splitGraphemes(text: string): string[] {
  const Segmenter = (Intl as unknown as { Segmenter?: new (locale?: string, options?: { granularity: "grapheme" }) => { segment: (value: string) => Iterable<{ segment: string }> } }).Segmenter;
  if (Segmenter) return [...new Segmenter(undefined, { granularity: "grapheme" }).segment(text)].map((item) => item.segment);
  return Array.from(text);
}
