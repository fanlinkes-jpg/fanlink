import { useEffect, useRef } from "react";
import { ChevronDown, ChevronUp, X } from "lucide-react";

/** Buscar texto dentro de la conversación abierta y saltar de un resultado al siguiente. */
export function ChatFindBar({
  query,
  onQuery,
  count,
  index,
  onStep,
  onClose,
}: {
  query: string;
  onQuery: (value: string) => void;
  count: number;
  index: number;
  onStep: (direction: 1 | -1) => void;
  onClose: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);
  const shown = query.trim().length < 2 ? "" : count === 0 ? "Sin resultados" : `${index + 1} de ${count}`;
  return (
    <div role="search" className="flex shrink-0 items-center gap-2 border-b border-[#e6e8ee] bg-[#fafbfd] px-4 py-2 text-sm">
      <input
        ref={input}
        aria-label="Buscar en la conversación"
        value={query}
        onChange={(event) => onQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") onStep(event.shiftKey ? -1 : 1);
          if (event.key === "Escape") onClose();
        }}
        placeholder="Buscar en esta conversación"
        className="h-8 min-w-0 flex-1 rounded-lg border border-[#e6e8ee] bg-white px-3"
      />
      <span className="w-24 shrink-0 text-right text-xs text-[#6d7585]" aria-live="polite">{shown}</span>
      <button type="button" aria-label="Anterior" disabled={count === 0} className="rounded p-1 hover:bg-[#eef2ff] disabled:opacity-40" onClick={() => onStep(-1)}><ChevronUp className="h-4 w-4" /></button>
      <button type="button" aria-label="Siguiente" disabled={count === 0} className="rounded p-1 hover:bg-[#eef2ff] disabled:opacity-40" onClick={() => onStep(1)}><ChevronDown className="h-4 w-4" /></button>
      <button type="button" aria-label="Cerrar búsqueda" className="rounded p-1 hover:bg-[#eef2ff]" onClick={onClose}><X className="h-4 w-4" /></button>
    </div>
  );
}
