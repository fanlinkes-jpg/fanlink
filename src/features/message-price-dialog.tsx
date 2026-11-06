import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { messagePriceCents, moneyLabel, priceChartLayout, purchasedPpvSeries, type PpvPoint } from "@/lib/composer-tools";

type PricedMessage = {
  fromFan: boolean;
  purchased: boolean | null;
  priceCents: number | null;
  sentAt: string;
};

export function MessagePriceDialog({
  initial,
  messages,
  onCancel,
  onSave,
}: {
  initial: string;
  messages: PricedMessage[];
  onCancel: () => void;
  onSave: (cents: number | null) => void;
}) {
  const [raw, setRaw] = useState(initial);
  const parsed = messagePriceCents(raw);
  const series = purchasedPpvSeries(messages);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4" onMouseDown={onCancel}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="precio-del-mensaje"
        className="max-h-[calc(100vh-2rem)] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-4 shadow-xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 id="precio-del-mensaje" className="text-base font-semibold text-[#1c2333]">Precio del mensaje</h2>
        <label className="mt-3 flex h-10 items-center gap-1 rounded-lg border border-[#e6e8ee] px-3">
          <span className="text-sm text-[#6d7585]">$</span>
          <input
            aria-label="Precio"
            value={raw}
            placeholder="Gratis"
            onChange={(event) => setRaw(event.target.value)}
            className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[#9aa1b1]"
          />
        </label>
        <p className={`mt-1 text-xs ${parsed.ok ? "text-[#6d7585]" : "text-[#b42318]"}`}>Mínimo $3 USD o gratis</p>
        <section className="mt-4">
          <h3 className="text-sm font-medium">Últimos PPV comprados por el fan</h3>
          <div className="mt-2 flex gap-6 text-sm">
            <p>Máx <span className="font-semibold">{moneyLabel(series.maxCents)}</span></p>
            <p>Media <span className="font-semibold">{moneyLabel(series.avgCents)}</span></p>
          </div>
          {series.points.length === 0 ? <p className="mt-3 text-sm text-[#6d7585]">Sin datos</p> : <PpvPriceChart points={series.points} />}
        </section>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="rounded-lg px-3 py-2 text-sm" onClick={onCancel}>Cancelar</button>
          <button
            type="button"
            disabled={!parsed.ok}
            className="rounded-lg bg-[#3b6cff] px-3 py-2 text-sm text-white disabled:opacity-40"
            onClick={() => {
              if (parsed.ok) onSave(parsed.cents);
            }}
          >
            Guardar
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function PpvPriceChart({ points }: { points: PpvPoint[] }) {
  const width = 360;
  const height = 128;
  const dots = priceChartLayout(points, width, height);
  return (
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Gráfica de precio por fecha" className="mt-2 h-32 w-full">
      <polyline fill="none" stroke="#3b6cff" strokeWidth="2" points={dots.map((dot) => `${dot.x},${dot.y}`).join(" ")} />
      {dots.map((dot, index) => (
        <g key={`${dot.date}-${index}`}>
          <circle cx={dot.x} cy={dot.y} r="3.5" fill="#3b6cff" />
          <text x={dot.x} y={Math.max(12, dot.y - 8)} textAnchor="middle" fontSize="11" fill="#1c2333">{dot.label}</text>
          {dot.date ? <text x={dot.x} y={height - 2} textAnchor="middle" fontSize="10" fill="#6d7585">{dot.date}</text> : null}
        </g>
      ))}
    </svg>
  );
}
