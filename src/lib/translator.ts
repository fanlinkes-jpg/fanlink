/**
 * Traducción con las APIs integradas de Chrome (Translator y Language Detector, Chrome 138+ en escritorio).
 * Todo ocurre en el navegador del operador: no hay clave, servidor ni coste, y el texto del fan no sale del equipo.
 * El módulo no toca `window`: recibe el host (por defecto `globalThis`) para poder probarlo con un mock.
 */

/**
 * Idiomas que ofrece el Translator de Chrome (lista de la documentación de Chrome, que puede crecer).
 * Español primero, es el valor por defecto; el resto, por nombre. Si Chrome no tiene un par concreto,
 * `availability` lo dice y el mensaje enseña «Chrome no ofrece esa traducción».
 */
export const TRANSLATE_LANGUAGES = [
  { id: "es", label: "Español" },
  { id: "de", label: "Alemán" },
  { id: "ar", label: "Árabe" },
  { id: "bn", label: "Bengalí" },
  { id: "bg", label: "Búlgaro" },
  { id: "kn", label: "Canarés" },
  { id: "cs", label: "Checo" },
  { id: "zh", label: "Chino (simplificado)" },
  { id: "zh-Hant", label: "Chino (tradicional)" },
  { id: "ko", label: "Coreano" },
  { id: "hr", label: "Croata" },
  { id: "da", label: "Danés" },
  { id: "sk", label: "Eslovaco" },
  { id: "sl", label: "Esloveno" },
  { id: "fi", label: "Finés" },
  { id: "fr", label: "Francés" },
  { id: "el", label: "Griego" },
  { id: "he", label: "Hebreo" },
  { id: "hi", label: "Hindi" },
  { id: "nl", label: "Holandés" },
  { id: "hu", label: "Húngaro" },
  { id: "id", label: "Indonesio" },
  { id: "en", label: "Inglés" },
  { id: "it", label: "Italiano" },
  { id: "ja", label: "Japonés" },
  { id: "lt", label: "Lituano" },
  { id: "mr", label: "Maratí" },
  { id: "no", label: "Noruego" },
  { id: "pl", label: "Polaco" },
  { id: "pt", label: "Portugués" },
  { id: "ro", label: "Rumano" },
  { id: "ru", label: "Ruso" },
  { id: "sv", label: "Sueco" },
  { id: "th", label: "Tailandés" },
  { id: "ta", label: "Tamil" },
  { id: "te", label: "Telugu" },
  { id: "tr", label: "Turco" },
  { id: "uk", label: "Ucraniano" },
  { id: "vi", label: "Vietnamita" },
] as const;

export type TranslateLanguage = (typeof TRANSLATE_LANGUAGES)[number]["id"];

export function isTranslateLanguage(value: unknown): value is TranslateLanguage {
  return TRANSLATE_LANGUAGES.some((item) => item.id === value);
}

export function languageLabel(code: string): string {
  const clean = code.trim();
  return TRANSLATE_LANGUAGES.find((item) => item.id.toLowerCase() === clean.toLowerCase())?.label
    ?? TRANSLATE_LANGUAGES.find((item) => item.id === baseLanguage(clean))?.label
    ?? clean.toUpperCase();
}

/**
 * Código para la API. `pt-BR` → `pt`, `iw` → `he`. El chino conserva su variante porque Chrome
 * distingue `zh` y `zh-Hant`; el resto, minúsculas y sin región.
 */
export function baseLanguage(code: string): string {
  const clean = code.trim().replace(/_/g, "-");
  if (/^zh-(hant|tw|hk|mo)/i.test(clean)) return "zh-Hant";
  const base = clean.toLowerCase().split("-")[0] ?? "";
  if (base === "iw") return "he";
  if (base === "nb" || base === "nn") return "no";
  return base;
}

export type Availability = "unsupported" | "unavailable" | "downloadable" | "downloading" | "available";

type MonitorLike = { addEventListener: (type: "downloadprogress", listener: (event: { loaded: number }) => void) => void };
type TranslatorLike = { translate: (text: string) => Promise<string>; destroy?: () => void };
type DetectorLike = { detect: (text: string) => Promise<Array<{ detectedLanguage: string; confidence: number }>> };

export type TranslatorHost = {
  Translator?: {
    availability: (options: { sourceLanguage: string; targetLanguage: string }) => Promise<string>;
    create: (options: { sourceLanguage: string; targetLanguage: string; monitor?: (monitor: MonitorLike) => void }) => Promise<TranslatorLike>;
  };
  LanguageDetector?: {
    availability: (options?: { expectedInputLanguages?: string[] }) => Promise<string>;
    create: (options?: { expectedInputLanguages?: string[]; monitor?: (monitor: MonitorLike) => void }) => Promise<DetectorLike>;
  };
  navigator?: { userActivation?: { isActive?: boolean } };
};

export type TranslateErrorCode = "unsupported" | "needs-download" | "download-failed" | "pair-unavailable" | "detect-failed" | "failed";

export class TranslateError extends Error {
  readonly code: TranslateErrorCode;
  readonly source: string | null;
  readonly target: string | null;
  constructor(code: TranslateErrorCode, source: string | null = null, target: string | null = null) {
    super(code);
    this.code = code;
    this.source = source;
    this.target = target;
  }
}

export function translateNotice(code: TranslateErrorCode, source: string | null = null, target: string | null = null): string {
  switch (code) {
    case "unsupported":
      return "La traducción no está disponible en este navegador.";
    case "needs-download":
      return "Falta descargar el idioma. Haz clic en la página y se descargará solo.";
    case "download-failed":
      return "No se pudo descargar el paquete de idioma. Inténtalo otra vez con un clic.";
    case "pair-unavailable":
      return source && target ? `Chrome no ofrece la traducción ${source.toUpperCase()} → ${target.toUpperCase()}.` : "Chrome no ofrece ese par de idiomas.";
    case "detect-failed":
      return "No se pudo detectar el idioma. Elígelo en el selector.";
    case "failed":
      return "No se pudo traducir.";
  }
}

export function browserHost(): TranslatorHost {
  const g = globalThis as unknown as Record<string, unknown>;
  return {
    Translator: g.Translator as TranslatorHost["Translator"],
    LanguageDetector: g.LanguageDetector as TranslatorHost["LanguageDetector"],
    navigator: typeof navigator === "undefined" ? undefined : (navigator as unknown as TranslatorHost["navigator"]),
  };
}

export function translatorSupported(host: TranslatorHost = browserHost()): boolean {
  return typeof host.Translator?.availability === "function" && typeof host.Translator?.create === "function";
}

export function detectorSupported(host: TranslatorHost = browserHost()): boolean {
  return typeof host.LanguageDetector?.availability === "function" && typeof host.LanguageDetector?.create === "function";
}

function asAvailability(value: string): Availability {
  if (value === "available" || value === "downloadable" || value === "downloading") return value;
  return "unavailable";
}

export async function pairAvailability(host: TranslatorHost, source: string, target: string): Promise<Availability> {
  if (!translatorSupported(host)) return "unsupported";
  try {
    return asAvailability(await host.Translator!.availability({ sourceLanguage: baseLanguage(source), targetLanguage: baseLanguage(target) }));
  } catch {
    return "unavailable";
  }
}

export async function detectorAvailability(host: TranslatorHost): Promise<Availability> {
  if (!detectorSupported(host)) return "unsupported";
  try {
    return asAvailability(await host.LanguageDetector!.availability());
  } catch {
    return "unavailable";
  }
}

function userActive(host: TranslatorHost): boolean {
  return host.navigator?.userActivation?.isActive === true;
}

export type ProgressFn = (fraction: number) => void;

// Un traductor por par y host. La promesa se guarda para que dos mensajes no creen dos.
const translators = new WeakMap<object, Map<string, Promise<TranslatorLike>>>();
const detectors = new WeakMap<object, Promise<DetectorLike>>();
const results = new Map<string, string>();
const RESULT_CAP = 600;

/** Solo para tests: vacía cachés. */
export function resetTranslatorCaches(): void {
  results.clear();
}

function translatorMap(host: TranslatorHost): Map<string, Promise<TranslatorLike>> {
  let map = translators.get(host);
  if (!map) {
    map = new Map();
    translators.set(host, map);
  }
  return map;
}

function monitorFor(onProgress?: ProgressFn): ((monitor: MonitorLike) => void) | undefined {
  if (!onProgress) return undefined;
  return (monitor) => monitor.addEventListener("downloadprogress", (event) => onProgress(Math.max(0, Math.min(1, event.loaded))));
}

/**
 * Crea (o reutiliza) el traductor del par. Si el paquete hay que descargarlo, Chrome exige un gesto del
 * usuario: sin él, error `needs-download`; la interfaz reintenta sola con el siguiente clic.
 */
export async function prepareTranslator(
  host: TranslatorHost,
  sourceRaw: string,
  targetRaw: string,
  options: { onProgress?: ProgressFn; gesture?: boolean } = {},
): Promise<TranslatorLike> {
  const source = baseLanguage(sourceRaw);
  const target = baseLanguage(targetRaw);
  if (!translatorSupported(host)) throw new TranslateError("unsupported", source, target);
  const key = `${source}>${target}`;
  const cached = translatorMap(host).get(key);
  if (cached) return cached;
  const availability = await pairAvailability(host, source, target);
  if (availability === "unavailable" || availability === "unsupported") throw new TranslateError("pair-unavailable", source, target);
  const gesture = options.gesture ?? userActive(host);
  if ((availability === "downloadable" || availability === "downloading") && !gesture) {
    throw new TranslateError("needs-download", source, target);
  }
  const created = host.Translator!.create({ sourceLanguage: source, targetLanguage: target, monitor: monitorFor(options.onProgress) })
    .catch((error: unknown) => {
      translatorMap(host).delete(key);
      const name = error instanceof Error ? error.name : "";
      throw new TranslateError(name === "NotAllowedError" ? "needs-download" : availability === "available" ? "failed" : "download-failed", source, target);
    });
  translatorMap(host).set(key, created);
  return created;
}

/** Descarga el paquete del par con progreso. Hay que llamarla desde un clic. */
export async function downloadPair(host: TranslatorHost, source: string, target: string, onProgress?: ProgressFn): Promise<void> {
  await prepareTranslator(host, source, target, { onProgress, gesture: true });
}

async function prepareDetector(host: TranslatorHost, options: { onProgress?: ProgressFn; gesture?: boolean } = {}): Promise<DetectorLike | null> {
  if (!detectorSupported(host)) return null;
  const cached = detectors.get(host);
  if (cached) return cached.catch(() => null);
  const availability = await detectorAvailability(host);
  if (availability === "unavailable" || availability === "unsupported") return null;
  const gesture = options.gesture ?? userActive(host);
  if ((availability === "downloadable" || availability === "downloading") && !gesture) throw new TranslateError("needs-download");
  const created = host.LanguageDetector!.create({ monitor: monitorFor(options.onProgress) });
  detectors.set(host, created);
  return created.catch((error: unknown) => {
    detectors.delete(host);
    if (error instanceof Error && error.name === "NotAllowedError") throw new TranslateError("needs-download");
    return null as unknown as DetectorLike;
  });
}

/** Descarga el detector de idioma, también desde un clic. Devuelve si quedó listo. */
export async function downloadDetector(host: TranslatorHost, onProgress?: ProgressFn): Promise<boolean> {
  return (await prepareDetector(host, { onProgress, gesture: true })) != null;
}

export type Detected = { language: string; confidence: number };

export async function detectLanguage(host: TranslatorHost, text: string, options: { onProgress?: ProgressFn; gesture?: boolean } = {}): Promise<Detected | null> {
  const clean = text.trim();
  if (!clean) return null;
  const detector = await prepareDetector(host, options);
  if (!detector) return null;
  try {
    const found = await detector.detect(clean);
    const top = found[0];
    if (!top || !top.detectedLanguage || top.detectedLanguage === "und") return null;
    return { language: baseLanguage(top.detectedLanguage), confidence: top.confidence };
  } catch {
    return null;
  }
}

const MIN_CONFIDENCE = 0.5;
const MIN_DETECT_CHARS = 8;

/**
 * Idioma de origen: el pedido; si no, el detectado con confianza suficiente; si no, el de respaldo
 * (el idioma habitual del fan). Sin ninguno, `detect-failed`.
 */
export async function resolveSource(
  host: TranslatorHost,
  text: string,
  requested: string | null,
  fallback: string | null,
  options: { onProgress?: ProgressFn; gesture?: boolean } = {},
): Promise<string> {
  if (requested) return baseLanguage(requested);
  const detected = text.trim().length >= MIN_DETECT_CHARS ? await detectLanguage(host, text, options) : null;
  if (detected && detected.confidence >= MIN_CONFIDENCE) return detected.language;
  if (fallback) return baseLanguage(fallback);
  if (detected) return detected.language;
  throw new TranslateError("detect-failed");
}

export type Translation = { text: string; source: string; target: string; same: boolean };

export async function translateText(
  host: TranslatorHost,
  text: string,
  options: { source: string | null; fallbackSource?: string | null; target: string; gesture?: boolean; onProgress?: ProgressFn },
): Promise<Translation> {
  if (!translatorSupported(host)) throw new TranslateError("unsupported");
  const target = baseLanguage(options.target);
  const trimmed = text.trim();
  if (!trimmed) return { text, source: options.source ? baseLanguage(options.source) : target, target, same: true };
  const source = await resolveSource(host, trimmed, options.source, options.fallbackSource ?? null, { onProgress: options.onProgress, gesture: options.gesture });
  if (source === target) return { text, source, target, same: true };
  const cacheKey = `${source}>${target}\u0000${trimmed}`;
  const hit = results.get(cacheKey);
  if (hit != null) return { text: hit, source, target, same: false };
  const translator = await prepareTranslator(host, source, target, { onProgress: options.onProgress, gesture: options.gesture });
  let out: string;
  try {
    out = await translator.translate(trimmed);
  } catch {
    throw new TranslateError("failed", source, target);
  }
  if (results.size >= RESULT_CAP) results.delete(results.keys().next().value as string);
  results.set(cacheKey, out);
  return { text: out, source, target, same: false };
}

/** Varios párrafos en orden. Uno que falla corta todos: no se enseña una traducción a medias. */
export async function translateMany(
  host: TranslatorHost,
  texts: readonly string[],
  options: { source: string | null; fallbackSource?: string | null; target: string; gesture?: boolean; onProgress?: ProgressFn },
): Promise<{ texts: string[]; source: string; same: boolean }> {
  const joined = texts.join("\n");
  const source = await resolveSource(host, joined, options.source, options.fallbackSource ?? null, { onProgress: options.onProgress, gesture: options.gesture });
  const out: string[] = [];
  let same = true;
  for (const text of texts) {
    const done = await translateText(host, text, { ...options, source });
    if (!done.same) same = false;
    out.push(done.text);
  }
  return { texts: out, source, same };
}

/** Idioma habitual del fan: el que domina en sus últimos mensajes, solo entre los que el selector ofrece. */
export async function fanLanguageOf(host: TranslatorHost, fanTexts: readonly string[]): Promise<string | null> {
  const votes = new Map<string, number>();
  for (const text of fanTexts.slice(-6)) {
    const found = await detectLanguage(host, text).catch(() => null);
    if (!found || found.confidence < MIN_CONFIDENCE || !isTranslateLanguage(found.language)) continue;
    votes.set(found.language, (votes.get(found.language) ?? 0) + text.trim().length * found.confidence);
  }
  let best: string | null = null;
  let score = 0;
  for (const [language, value] of votes) {
    if (value > score) {
      best = language;
      score = value;
    }
  }
  return best;
}
