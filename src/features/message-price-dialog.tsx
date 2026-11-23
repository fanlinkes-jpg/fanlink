import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { messagePriceCents, moneyLabel, priceChartLayout, type PpvPoint } from "@/lib/composer-tools";
import { readFanPurchases } from "@/lib/of-sessions";

type PurchaseSeries = { maxCents: number | null; avgCents: number | null; points: PpvPoint[] };

const EMPTY_SERIES: PurchaseSeries = { maxCents: null, avgCents: null, points: [] };

export function MessagePriceDialog({
  initial,
  creatorId,
  threadKey,
  onCancel,
  onSave,
}: {
  initial: string;
  creatorId: string | null;
  threadKey: string | null;
  onCancel: () => void;
  onSave: (cents: number | null) => void;
}) {
  const [raw, setRaw] = useState(initial);
  const parsed = messagePriceCents(raw);
  const [series, setSeries] = useState<PurchaseSeries>(EMPTY_SERIES);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  useEffect(() => {
    if (!creatorId || !threadKey) {
      setSeries(EMPTY_SERIES);
      setReady(true);
      return;
    }
    let stop = false;
    setReady(false);
    void readFanPurchases({ data: { creatorId, threadKey } })
      .then((value) => {
        if (!stop) setSeries(value);
      })
      .catch(() => {
        if (!stop) setSeries(EMPTY_SERIES);
      })
      .finally(() => {
        if (!stop) setReady(true);
      });
    return () => {
      stop = true;
    };
  }, [creatorId, threadKey]);

  if (typeof document === "undefined") return null;
  const maxLabel = ready ? moneyLabel(series.maxCents) : "Cargando";
  const avgLabel = ready ? moneyLabel(series.avgCents) : "Cargando";

  return createPortal(
    <div className="fixed inset-0 z-[90] grid place-items-center bg-overlay p-4" onMouseDown={onCancel}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="precio-del-mensaje"
        className="max-h-[calc(100vh-2rem)] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-4 shadow-xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 id="precio-del-mensaje" className="text-base font-semibold text-fg">Precio del mensaje</h2>
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
          <div className="mt-2 flex gap-6 text-sm text-warning">
            <p>Máx <span className="font-semibold">{maxLabel}</span></p>
            <p>Media <span className="font-semibold">{avgLabel}</span></p>
          </div>
          {!ready ? <p className="mt-3 text-sm text-muted">Cargando</p> : series.points.length === 0 ? <p className="mt-3 text-sm text-muted">Sin datos</p> : <PpvPriceChart points={series.points} />}
        </section>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="rounded-lg px-3 py-2 text-sm" onClick={onCancel}>Cancelar</button>
          <button
            type="button"
            disabled={!parsed.ok}
            className="rounded-lg bg-primary px-3 py-2 text-sm text-primary-fg disabled:opacity-40"
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
      <polyline fill="none" stroke="var(--color-success)" strokeWidth="2" points={dots.map((dot) => `${dot.x},${dot.y}`).join(" ")} />
      {dots.map((dot, index) => (
        <g key={`${dot.date}-${index}`}>
          <circle cx={dot.x} cy={dot.y} r="3.5" fill="var(--color-success)" />
          <text x={dot.x} y={Math.max(12, dot.y - 8)} textAnchor="middle" fontSize="11" fill="var(--color-success)">{dot.label}</text>
          {dot.date ? <text x={dot.x} y={height - 2} textAnchor="middle" fontSize="10" fill="#6d7585">{dot.date}</text> : null}
        </g>
      ))}
    </svg>
  );
}
