import { useState } from "react";
import { matchScripts } from "@/lib/composer-tools";
import { moneyOrEmpty } from "@/lib/fan-insights";

type ScriptSource = { id: string; title: string; keyword: string; steps: Array<{ text: string; price?: number }> };

export function DeskRail({
  name,
  handle,
  spentCents,
  ppvAvgCents,
  canType,
  pasteNote,
  scripts,
  onPaste,
  onOpenFicha,
}: {
  name: string | null;
  handle: string | null;
  spentCents: number | null;
  ppvAvgCents: number | null;
  canType: boolean;
  pasteNote: string | null;
  scripts: ScriptSource[];
  onPaste: (text: string) => void;
  onOpenFicha: () => void;
}) {
  const [query, setQuery] = useState("");
  const hits = matchScripts(scripts, query);
  return (
    <aside className="flex w-[300px] shrink-0 flex-col border-l border-[#e6e8ee] bg-white">
      <div className="border-b border-[#e6e8ee] px-3 py-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-[#6d7585]">Fanlink</p>
        <p className="truncate text-sm font-medium">{name ?? "Elige un fan"}</p>
        <p className="truncate text-xs text-[#6d7585]">{handle ? `@${handle.replace(/^@/, "")}` : "Sin datos"}</p>
        <dl className="mt-2 grid grid-cols-2 gap-2 text-xs">
          <div>
            <dt className="text-[#6d7585]">Gasto</dt>
            <dd>{moneyOrEmpty(spentCents)}</dd>
          </div>
          <div>
            <dt className="text-[#6d7585]">PPV medio</dt>
            <dd>{moneyOrEmpty(ppvAvgCents)}</dd>
          </div>
        </dl>
        <button type="button" className="mt-2 text-xs text-[#2456c7]" onClick={onOpenFicha}>Abrir ficha</button>
      </div>
      <div className="border-b border-[#e6e8ee] px-3 py-2 text-xs text-[#6d7585]">
        Se escribe en la página de OnlyFans. El guion se pega ahí. El precio y el vault se confirman en esa página, antes de Send.
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        <input
          aria-label="Buscar guiones"
          value={query}
          placeholder="Buscar guiones"
          onChange={(event) => setQuery(event.target.value)}
          className="mb-2 h-8 w-full rounded border border-[#e6e8ee] px-2 text-sm"
        />
        {hits.length === 0 ? <p className="text-xs text-[#6d7585]">Sin datos</p> : hits.map((hit) => (
          <button
            key={hit.id}
            type="button"
            className="mb-1 block w-full rounded px-2 py-1.5 text-left hover:bg-[#f4f7ff]"
            onClick={() => onPaste(hit.text)}
          >
            <span className="block text-sm">{hit.title}</span>
            <span className="text-[11px] text-[#6d7585]">/{hit.keyword}{hit.priceCents != null ? ` · $${(hit.priceCents / 100).toFixed(2)} en la página` : ""}</span>
          </button>
        ))}
      </div>
      <p className="shrink-0 border-t border-[#e6e8ee] px-3 py-2 text-xs text-[#8a5a12]">
        {pasteNote ?? (canType ? "Tienes el teclado. Pega un guion o escribe en la página." : "Toma el control para pegar un guion.")}
      </p>
    </aside>
  );
}
