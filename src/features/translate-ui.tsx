import { useState } from "react";
import { Download, Languages, Loader2 } from "lucide-react";
import {
  COMPOSER_LANGUAGES,
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
import {
  startDetectorDownload,
  startDownload,
  useDownloadState,
  useFanLanguage,
  usePairAvailability,
  useTranslatorSupport,
} from "@/lib/use-translator";

/** Botón Descargar de un paquete de idioma, con progreso. Solo se descarga con este clic. */
export function DownloadButton({ source, target }: { source: string; target: string }) {
  const state = useDownloadState(source, target);
  const busy = state?.state === "downloading";
  return (
    <button
      type="button"
      disabled={busy}
      className="inline-flex items-center gap-1 rounded border border-[#e6e8ee] px-2 py-0.5 text-xs font-medium text-[#2456c7] disabled:opacity-70"
      onClick={() => { void startDownload(source, target); void startDetectorDownload(); }}
    >
      {busy ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : <Download className="h-3 w-3" aria-hidden />}
      {busy ? `Descargando ${Math.round((state?.progress ?? 0) * 100)} %` : state?.state === "error" ? "Reintentar descarga" : "Descargar"}
    </button>
  );
}

/** Aviso de un fallo de traducción. Si falta un paquete, trae el botón para bajarlo. */
export function TranslateNotice({ code, source, target }: { code: TranslateErrorCode; source: string | null; target: string | null }) {
  return (
    <span role="status" className="inline-flex flex-wrap items-center gap-2 text-[11px] text-[#8a5a12]">
      {translateNotice(code, source, target)}
      {code === "needs-download" && source && target ? <DownloadButton source={source} target={target} /> : null}
    </span>
  );
}

const PACK_PAIRS = (target: string) => {
  const others = TRANSLATE_LANGUAGES.map((item) => item.id).filter((id) => id !== target);
  return [
    ...others.map((id) => [id, target] as const),
    ...others.map((id) => [target, id] as const),
  ];
};

/** Menú de la barra superior: idioma, modo y paquetes. El interruptor Auto va aparte, al lado. */
export function TranslateMenu({ onClose }: { onClose: () => void }) {
  const language = useComposerLanguage();
  const mode = useTranslateMode();
  const supported = useTranslatorSupport();
  const pairs = PACK_PAIRS(language);
  const availability = usePairAvailability(pairs, supported);
  return (
    <div className="absolute right-0 z-30 mt-1 w-72 rounded-lg border border-[#e6e8ee] bg-white p-3 text-xs text-[#1c2333] shadow-lg" aria-label="Ajustes de traducción">
      <p className="mb-2 text-[11px] text-[#6d7585]">Traduce con el traductor integrado de Chrome. Es gratis y el texto no sale de tu equipo.</p>
      {!supported ? (
        <p role="alert" className="mb-2 rounded bg-[#fff6e5] px-2 py-1.5 text-[#8a5a12]">{translateNotice("unsupported")}</p>
      ) : null}
      <div role="listbox" aria-label="Idioma" className="mb-2 grid grid-cols-2 gap-1">
        {COMPOSER_LANGUAGES.map((item) => (
          <button
            key={item.id}
            type="button"
            role="option"
            aria-selected={item.id === language}
            className={`rounded px-2 py-1.5 text-left ${item.id === language ? "bg-[#e7f3ff]" : "hover:bg-[#f4f6f8]"}`}
            onClick={() => setComposerLanguage(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <p className="mb-1 font-medium">Mostrar la traducción</p>
      <div className="mb-2 flex gap-1" role="radiogroup" aria-label="Modo de traducción">
        {([["below", "Bajo el original"], ["replace", "En lugar del original"]] as const).map(([id, label]) => (
          <button key={id} type="button" role="radio" aria-checked={mode === id} className={`flex-1 rounded border px-2 py-1 ${mode === id ? "border-[#2456c7] bg-[#e7f3ff]" : "border-[#e6e8ee]"}`} onClick={() => setTranslateMode(id)}>{label}</button>
        ))}
      </div>
      {supported ? (
        <>
          <p className="mb-1 font-medium">Paquetes de idioma</p>
          <ul className="mb-2 space-y-1">
            {pairs.map(([source, target]) => {
              const found = availability[`${source}>${target}`];
              return (
                <li key={`${source}>${target}`} className="flex items-center justify-between gap-2">
                  <span>{source.toUpperCase()} → {target.toUpperCase()}</span>
                  {found === "available" ? <span className="text-[#1a7f45]">Listo</span>
                    : found === "unavailable" ? <span className="text-[#8b909a]">No disponible</span>
                    : found ? <DownloadButton source={source} target={target} /> : <span className="text-[#8b909a]">…</span>}
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
      <div className="flex justify-end">
        <button type="button" className="text-[11px] font-semibold uppercase tracking-wide text-[#00aff0]" onClick={onClose}>Cerrar</button>
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
        setDone(`Traducido de ${result.source.toUpperCase()} a ${target.toUpperCase()}. Revísalo antes de enviar: no se envía solo.`);
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
        <label className="block">Tu idioma
          <select aria-label="Idioma" value={own} onChange={(event) => { if (isTranslateLanguage(event.target.value)) setComposerLanguage(event.target.value); }} className="mt-1 block h-8 rounded border border-[#e6e8ee] px-2 text-sm text-[#1c2333]">
            {COMPOSER_LANGUAGES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </label>
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
      {supported && empty ? <p>Escribe el mensaje y pulsa Traducir. El resultado se pone en el cuadro para que lo revises.</p> : null}
      {done ? <p role="status" className="text-[#1a7f45]">{done}</p> : null}
      {problem ? <TranslateNotice code={problem.code} source={problem.source} target={problem.target} /> : null}
    </div>
  );
}
