import { useState } from "react";
import { ChevronDown, Languages, Loader2 } from "lucide-react";
import {
  setAutoTranslate,
  setComposerLanguage,
  setTranslateMode,
  useAutoTranslate,
  useComposerLanguage,
  useTranslateMode,
} from "@/lib/ui-prefs";
import {
  TRANSLATE_LANGUAGES,
  TranslateError,
  browserHost,
  isTranslateLanguage,
  languageLabel,
  translateNotice,
  translateText,
  type TranslateErrorCode,
} from "@/lib/translator";
import { useFanLanguage, useTranslatorSupport } from "@/lib/use-translator";

/** Spinner pequeño de un mensaje mientras se traduce o se descarga el modelo la primera vez. */
export function TranslateSpinner({ progress }: { progress: number | null }) {
  return (
    <span role="status" aria-label="Traduciendo" className="inline-flex items-center gap-1 text-[#6d7585]">
      <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
      {progress != null && progress > 0 && progress < 1 ? <span>{Math.round(progress * 100)} %</span> : null}
    </span>
  );
}

/** Aviso de un fallo de traducción. */
export function TranslateNotice({ code, source, target }: { code: TranslateErrorCode; source: string | null; target: string | null }) {
  return (
    <span role="status" className="inline-flex flex-wrap items-center gap-2 text-[11px] text-[#8a5a12]">
      {translateNotice(code, source, target)}
    </span>
  );
}

/** Botón de la barra superior: icono de traducir y una flecha. */
export function TranslateMenuButton({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-label="Traducción"
      aria-haspopup="dialog"
      aria-expanded={open}
      onClick={onToggle}
      className={`flex h-8 items-center gap-0.5 rounded-lg px-2 ${open ? "bg-[#ff7a2f]" : "bg-white/10"}`}
    >
      <Languages className="h-4 w-4" aria-hidden />
      <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
    </button>
  );
}

/** Popover de la barra superior: idioma de destino y si se oculta el original. Se guardan solos. */
export function TranslateMenu() {
  const language = useComposerLanguage();
  const mode = useTranslateMode();
  const hideOriginal = mode === "replace";
  return (
    <div role="dialog" aria-label="Traducir mensajes de fans" className="absolute right-0 z-30 mt-1 w-72 rounded-xl border border-[#e6e8ee] bg-white p-4 text-[#1c2333] shadow-lg">
      <p className="text-sm font-semibold">Traducir mensajes de fans a</p>
      <select
        aria-label="Idioma de destino"
        value={language}
        onChange={(event) => { if (isTranslateLanguage(event.target.value)) setComposerLanguage(event.target.value); }}
        className="mt-2 block h-9 w-full rounded-lg border border-[#e6e8ee] bg-white px-2 text-sm"
      >
        {TRANSLATE_LANGUAGES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
      </select>
      <div className="mt-4 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">Ocultar texto original</p>
          <p className="text-xs text-[#6d7585]">Mostrar solo el texto traducido</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={hideOriginal}
          aria-label="Ocultar texto original"
          onClick={() => setTranslateMode(hideOriginal ? "below" : "replace")}
          className={`relative h-6 w-10 shrink-0 rounded-full transition-colors ${hideOriginal ? "bg-[#00aff0]" : "bg-[#d5d9e0]"}`}
        >
          <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${hideOriginal ? "left-[18px]" : "left-0.5"}`} />
        </button>
      </div>
    </div>
  );
}

/** Interruptor de la traducción automática de los mensajes del fan. */
export function AutoTranslateSwitch() {
  const auto = useAutoTranslate();
  const supported = useTranslatorSupport();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={auto}
      aria-label="Traducción automática"
      title={supported ? "Traducir automáticamente los mensajes del fan" : translateNotice("unsupported")}
      onClick={() => setAutoTranslate(!auto)}
      className={`h-8 rounded-lg px-2 text-xs font-semibold ${auto ? "bg-[#1f9d55] text-white" : "bg-white/10"}`}
    >
      Auto
    </button>
  );
}

/** Icono de traducir de un mensaje del fan. */
export function MessageTranslateButton({ active, onClick }: { active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label="Traducir mensaje"
      aria-pressed={active}
      title={active ? "Ocultar traducción" : "Traducir"}
      onClick={onClick}
      className={`inline-grid h-6 w-6 place-items-center rounded-full ${active ? "bg-[#e7f3ff] text-[#2456c7]" : "text-[#8b909a] hover:bg-[#f1f3f7]"}`}
    >
      <Languages className="h-3.5 w-3.5" />
    </button>
  );
}

/** Panel Translation del compositor: traduce lo que escribe el chatter al idioma del fan. Nunca envía. */
export function ComposerTranslationPanel({
  draft,
  fanTexts,
  fanChoice,
  onFanChoice,
  onTranslated,
  canUndo,
  onUndo,
}: {
  draft: string;
  fanTexts: readonly string[];
  fanChoice: string;
  onFanChoice: (value: string) => void;
  onTranslated: (text: string, original: string) => void;
  canUndo: boolean;
  onUndo: () => void;
}) {
  const own = useComposerLanguage();
  const supported = useTranslatorSupport();
  const detected = useFanLanguage(fanTexts, supported && fanChoice === "auto");
  const target = fanChoice === "auto" ? detected : fanChoice;
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [problem, setProblem] = useState<{ code: TranslateErrorCode; source: string | null; target: string | null } | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const empty = draft.trim() === "";

  async function translate() {
    if (!target || empty) return;
    setBusy(true);
    setProblem(null);
    setDone(null);
    setProgress(null);
    try {
      const result = await translateText(browserHost(), draft, { source: null, fallbackSource: own, target, gesture: true, onProgress: setProgress });
      if (result.same) {
        setDone(`El texto ya está en ${languageLabel(target)}.`);
      } else {
        onTranslated(result.text, draft);
        setDone(`Traducido de ${result.source.toUpperCase()} a ${target.toUpperCase()}.`);
      }
    } catch (error) {
      const code = error instanceof TranslateError ? error.code : "failed";
      setProblem({ code, source: error instanceof TranslateError ? error.source : null, target: error instanceof TranslateError ? error.target : target });
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  return (
    <div className="space-y-2 text-xs text-[#6d7585]">
      {!supported ? <p role="alert" className="rounded bg-[#fff6e5] px-2 py-1.5 text-[#8a5a12]">{translateNotice("unsupported")}</p> : null}
      <div className="flex flex-wrap items-end gap-3">
        <label className="block">Idioma del fan
          <select aria-label="Lengua del fan" value={fanChoice} onChange={(event) => onFanChoice(event.target.value)} className="mt-1 block h-8 rounded border border-[#e6e8ee] px-2 text-sm text-[#1c2333]">
            <option value="auto">{detected ? `Detectado: ${languageLabel(detected)}` : "Detectar de sus mensajes"}</option>
            {TRANSLATE_LANGUAGES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={!supported || busy || empty || !target} className="rounded border border-[#e6e8ee] px-2 py-1 font-medium text-[#1c2333] disabled:opacity-50" onMouseDown={(event) => event.preventDefault()} onClick={() => void translate()}>
          {busy ? (progress != null ? `Descargando ${Math.round(progress * 100)} %` : "Traduciendo…") : target ? `Traducir mi mensaje a ${languageLabel(target)}` : "Traducir mi mensaje"}
        </button>
        {canUndo ? <button type="button" className="rounded border border-[#e6e8ee] px-2 py-1" onMouseDown={(event) => event.preventDefault()} onClick={onUndo}>Volver al original</button> : null}
      </div>
      {supported && !target && fanChoice === "auto" ? <p>No se pudo detectar el idioma del fan todavía. Elígelo en el selector.</p> : null}
      {done ? <p role="status" className="text-[#1a7f45]">{done}</p> : null}
      {problem ? <TranslateNotice code={problem.code} source={problem.source} target={problem.target} /> : null}
    </div>
  );
}
