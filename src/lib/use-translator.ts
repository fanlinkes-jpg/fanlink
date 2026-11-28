import { useEffect, useState, useSyncExternalStore } from "react";
import {
  TranslateError,
  browserHost,
  downloadWaiting,
  fanLanguageOf,
  translateMany,
  translatorSupported,
  warmUpInGesture,
  type TranslateErrorCode,
} from "./translator.ts";

/**
 * Estado compartido: los mensajes y el compositor se enteran de que algo cambió (un clic que permite
 * descargar, un detector que quedó listo) y reintentan.
 */
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

/** Cambia cada vez que hay que reintentar. */
export function useTranslatorVersion(): number {
  return useSyncExternalStore(subscribe, () => version, () => 0);
}

export function useTranslatorSupport(): boolean {
  return useSyncExternalStore(subscribe, () => translatorSupported(browserHost()), () => false);
}

let waitingForGesture = false;

/**
 * Chrome solo deja bajar el modelo dentro de un gesto del usuario. Lo que una traducción automática no
 * pudo bajar espera al primer pointerdown o keydown de la página: ahí se crea en el acto, en silencio, y
 * luego se relanza la traducción. Una sola vez por espera.
 */
function retryOnNextGesture(): void {
  if (waitingForGesture || typeof document === "undefined" || !downloadWaiting()) return;
  waitingForGesture = true;
  const run = () => {
    document.removeEventListener("pointerdown", run, true);
    document.removeEventListener("keydown", run, true);
    waitingForGesture = false;
    warmUpInGesture(browserHost());
    emit();
  };
  document.addEventListener("pointerdown", run, true);
  document.addEventListener("keydown", run, true);
}

export type TranslatedState =
  | { state: "idle" }
  | { state: "loading"; progress: number | null }
  | { state: "done"; texts: string[]; source: string; same: boolean }
  | { state: "error"; code: TranslateErrorCode; source: string | null; target: string | null };

/**
 * Traduce una lista de párrafos cuando `enabled`. La primera vez Chrome descarga el modelo (con un gesto
 * del usuario; sin él, el siguiente clic relanza la traducción) y mientras tanto `loading` trae el progreso.
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
    setState((current) => (current.state === "done" ? current : { state: "loading", progress: null }));
    translateMany(browserHost(), input.texts, {
      source: input.source ?? null,
      fallbackSource: input.fallbackSource ?? null,
      target: input.target,
      onProgress: (fraction) => {
        if (!stop) setState({ state: "loading", progress: fraction });
      },
    }).then((done) => {
      if (!stop) setState({ state: "done", texts: done.texts, source: done.source, same: done.same });
    }, (error: unknown) => {
      if (stop) return;
      const code = error instanceof TranslateError ? error.code : "failed";
      if (code === "needs-download") retryOnNextGesture();
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
      retryOnNextGesture();
      if (!stop) setLanguage(found);
    });
    return () => {
      stop = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, active, tick]);
  return language;
}
