import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  TranslateError,
  browserHost,
  downloadDetector,
  downloadPair,
  fanLanguageOf,
  pairAvailability,
  translateMany,
  translatorSupported,
  type Availability,
  type TranslateErrorCode,
} from "./translator.ts";

/** Estado de las descargas de paquetes: compartido por la barra superior, el compositor y los mensajes. */
export type DownloadState = { state: "downloading" | "done" | "error"; progress: number };

const downloads = new Map<string, DownloadState>();
const listeners = new Set<() => void>();
let version = 0;

function emit(): void {
  version += 1;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const pairKey = (source: string, target: string) => `${source}>${target}`;

/** Cambia cada vez que termina o avanza una descarga. Los mensajes lo usan para reintentar. */
export function useTranslatorVersion(): number {
  return useSyncExternalStore(subscribe, () => version, () => 0);
}

export function useDownloadState(source: string, target: string): DownloadState | null {
  useTranslatorVersion();
  return downloads.get(pairKey(source, target)) ?? null;
}

export function useTranslatorSupport(): boolean {
  return useSyncExternalStore(subscribe, () => translatorSupported(browserHost()), () => false);
}

/** Descarga un paquete. Se llama desde el clic del botón Descargar: Chrome exige ese gesto. */
export function startDownload(source: string, target: string): Promise<void> {
  const key = pairKey(source, target);
  downloads.set(key, { state: "downloading", progress: 0 });
  emit();
  return downloadPair(browserHost(), source, target, (fraction) => {
    downloads.set(key, { state: "downloading", progress: fraction });
    emit();
  }).then(
    () => {
      downloads.set(key, { state: "done", progress: 1 });
      emit();
    },
    () => {
      downloads.set(key, { state: "error", progress: 0 });
      emit();
    },
  );
}

/** Detector de idioma del navegador: se descarga en el mismo clic que activa la traducción. */
export function startDetectorDownload(): Promise<boolean> {
  return downloadDetector(browserHost()).then((ok) => {
    emit();
    return ok;
  });
}

export type TranslatedState =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "done"; texts: string[]; source: string; same: boolean }
  | { state: "error"; code: TranslateErrorCode; source: string | null; target: string | null };

/**
 * Traduce una lista de párrafos cuando `enabled`. Sin gesto no descarga: devuelve `needs-download`
 * y quien pinta enseña el botón. Reintenta solo cuando termina una descarga.
 */
export function useTranslated(input: {
  texts: readonly string[];
  enabled: boolean;
  target: string;
  /** Idioma del que se traduce, si se sabe. Si no, se detecta. */
  source?: string | null;
  /** Idioma habitual del fan: vale cuando el texto es demasiado corto para detectarlo. */
  fallbackSource?: string | null;
}): TranslatedState {
  const tick = useTranslatorVersion();
  const [state, setState] = useState<TranslatedState>({ state: "idle" });
  const key = JSON.stringify([input.texts, input.target, input.source ?? null, input.fallbackSource ?? null]);
  useEffect(() => {
    if (!input.enabled || input.texts.every((text) => !text.trim())) {
      setState({ state: "idle" });
      return;
    }
    let stop = false;
    setState((current) => (current.state === "done" ? current : { state: "loading" }));
    translateMany(browserHost(), input.texts, {
      source: input.source ?? null,
      fallbackSource: input.fallbackSource ?? null,
      target: input.target,
    }).then((done) => {
      if (!stop) setState({ state: "done", texts: done.texts, source: done.source, same: done.same });
    }, (error: unknown) => {
      if (stop) return;
      const code = error instanceof TranslateError ? error.code : "failed";
      setState({ state: "error", code, source: error instanceof TranslateError ? error.source : null, target: error instanceof TranslateError ? error.target : null });
    });
    return () => {
      stop = true;
    };
    // `key` resume texts, target y origen. `tick` reintenta cuando acaba una descarga.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, input.enabled, tick]);
  return state;
}

/** Disponibilidad de varios pares, para la lista de paquetes de la barra superior. */
export function usePairAvailability(pairs: ReadonlyArray<readonly [string, string]>, active: boolean): Record<string, Availability> {
  const tick = useTranslatorVersion();
  const [found, setFound] = useState<Record<string, Availability>>({});
  const key = pairs.map(([source, target]) => pairKey(source, target)).join(",");
  useEffect(() => {
    if (!active) return;
    let stop = false;
    void Promise.all(pairs.map(async ([source, target]) => [pairKey(source, target), await pairAvailability(browserHost(), source, target)] as const)).then((rows) => {
      if (!stop) setFound(Object.fromEntries(rows));
    });
    return () => {
      stop = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, active, tick]);
  return found;
}

/** Idioma del fan según sus últimos mensajes. Null mientras no haya detector o texto. */
export function useFanLanguage(fanTexts: readonly string[], active: boolean): string | null {
  const tick = useTranslatorVersion();
  const [language, setLanguage] = useState<string | null>(null);
  const key = JSON.stringify(fanTexts.slice(-6));
  useEffect(() => {
    if (!active || fanTexts.length === 0) {
      setLanguage(null);
      return;
    }
    let stop = false;
    void fanLanguageOf(browserHost(), fanTexts).then((found) => {
      if (!stop) setLanguage(found);
    });
    return () => {
      stop = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, active, tick]);
  return language;
}

/** Atajo para las listas de pares del idioma elegido contra los demás. */
export function useOtherLanguages(target: string, all: ReadonlyArray<{ id: string }>): string[] {
  return useMemo(() => all.map((item) => item.id).filter((id) => id !== target), [target, all]);
}
