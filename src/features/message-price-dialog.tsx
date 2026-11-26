import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { BarChart3, DollarSign, TrendingUp, X } from "lucide-react";
import { messagePriceCents, moneyLabel, priceChartLayout, type PpvPoint } from "@/lib/composer-tools";
import { readFanPurchases } from "@/lib/of-sessions";

type PurchaseSeries = { maxCents: number | null; avgCents: number | null; points: PpvPoint[] };

const EMPTY_SERIES: PurchaseSeries = { maxCents: null, avgCents: null, points: [] };
const CHART_GREEN = "#1f9d55";

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
  const shortcuts = useMemo(() => priceShortcuts(series), [series]);

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
  const maxLabel = ready ? moneyLabel(series.maxCents) : "…";
  const avgLabel = ready ? moneyLabel(series.avgCents) : "…";
  const purchaseCount = series.points.length;

  return createPortal(
    <div className="fixed inset-0 z-[90] grid place-items-center bg-black/45 p-4 backdrop-blur-[2px]" onMouseDown={onCancel}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="precio-del-mensaje"
        className="flex max-h-[calc(100vh-2rem)] w-full max-w-[420px] flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-[0_24px_80px_rgba(28,35,51,0.18)]"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex items-start gap-3 border-b border-line px-5 py-4">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#eef4ff] text-primary">
            <DollarSign className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="precio-del-mensaje" className="font-display text-lg font-semibold text-fg">Precio del mensaje</h2>
            <p className="mt-0.5 text-xs text-muted">PPV para este fan · mínimo $3 o gratis</p>
          </div>
          <button
            type="button"
            aria-label="Cerrar"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted hover:bg-raised"
            onClick={onCancel}
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <label className="block text-xs font-medium uppercase tracking-wide text-muted">Importe (USD)</label>
          <div
            className={`mt-2 flex h-14 items-center gap-2 rounded-xl border bg-raised/60 px-4 transition-colors ${
              parsed.ok ? "border-line focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20" : "border-[#f4b4ae] ring-2 ring-[#f4b4ae]/40"
            }`}
          >
            <span className="text-lg font-medium text-muted">$</span>
            <input
              aria-label="Precio"
              value={raw}
              placeholder="0 · Gratis"
              inputMode="decimal"
              onChange={(event) => setRaw(event.target.value)}
              className="min-w-0 flex-1 bg-transparent font-display text-2xl font-semibold tracking-tight text-fg outline-none placeholder:text-[#b4bac6]"
            />
          </div>
          <p className={`mt-2 text-xs ${parsed.ok ? "text-muted" : "font-medium text-danger"}`}>
            {parsed.ok ? "Mínimo $3 USD o gratis" : "Importe no válido: usa un número ≥ 3 o deja gratis"}
          </p>

          {shortcuts.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded-full border border-line bg-surface px-3 py-1 text-xs font-medium text-muted hover:border-primary/40 hover:text-fg"
                onClick={() => setRaw("")}
              >
                Gratis
              </button>
              {shortcuts.map((label) => (
                <button
                  key={label}
                  type="button"
                  className="rounded-full border border-[#d7e8ff] bg-[#f4f8ff] px-3 py-1 text-xs font-semibold text-primary hover:bg-[#e8f0ff]"
                  onClick={() => setRaw(label.replace(/^\$/, ""))}
                >
                  {label}
                </button>
              ))}
            </div>
          ) : null}

          <section className="mt-5 rounded-xl border border-line bg-linear-to-b from-[#fafbfc] to-surface p-4">
            <div className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-[#1f9d55]" aria-hidden />
              <h3 className="text-sm font-semibold text-fg">Últimos PPV comprados por el fan</h3>
              {purchaseCount > 0 ? (
                <span className="ml-auto rounded-full bg-raised px-2 py-0.5 text-[10px] font-semibold tabular-nums text-muted">
                  {purchaseCount} {purchaseCount === 1 ? "compra" : "compras"}
                </span>
              ) : null}
            </div>

            <div className="mt-3 grid grid-cols-2 gap-3">
              <StatCard label="Máximo" value={maxLabel} loading={!ready} accent="max" />
              <StatCard label="Media" value={avgLabel} loading={!ready} accent="avg" />
            </div>

            <div className="mt-4 rounded-lg border border-line/80 bg-surface p-2">
              {!ready ? (
                <div className="flex h-[148px] items-center justify-center text-sm text-muted">Cargando historial…</div>
              ) : series.points.length === 0 ? (
                <div className="flex h-[148px] flex-col items-center justify-center gap-1 text-center">
                  <TrendingUp className="h-8 w-8 text-line" aria-hidden />
                  <p className="text-sm text-muted">Sin datos</p>
                  <p className="max-w-[220px] text-[11px] text-muted">Aún no hay PPV pagados en este hilo ni en avisos de compra.</p>
                </div>
              ) : (
                <PpvPriceChart points={series.points} />
              )}
            </div>
          </section>
        </div>

        <footer className="flex justify-end gap-2 border-t border-line bg-surface px-5 py-4">
          <button type="button" className="rounded-lg px-4 py-2 text-sm font-medium text-muted hover:bg-raised" onClick={onCancel}>
            Cancelar
          </button>
          <button
            type="button"
            disabled={!parsed.ok}
            className="rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-primary-fg shadow-sm disabled:cursor-not-allowed disabled:opacity-40"
            onClick={() => {
              if (parsed.ok) onSave(parsed.cents);
            }}
          >
            Guardar
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

function StatCard({ label, value, loading, accent }: { label: string; value: string; loading: boolean; accent: "max" | "avg" }) {
  const tone = accent === "max" ? "text-[#c4841d]" : "text-[#1f9d55]";
  const bg = accent === "max" ? "from-[#fff8ef] to-surface" : "from-[#eef9f2] to-surface";
  return (
    <div className={`rounded-lg border border-line bg-linear-to-br ${bg} px-3 py-2.5`}>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">{label}</p>
      <p className={`mt-1 font-display text-lg font-semibold tabular-nums ${loading ? "text-muted" : tone}`}>{value}</p>
    </div>
  );
}

function priceShortcuts(series: PurchaseSeries): string[] {
  const out: string[] = [];
  const push = (cents: number | null) => {
    if (cents == null || cents < 300) return;
    const label = moneyLabel(cents);
    if (!out.includes(label)) out.push(label);
  };
  push(series.avgCents);
  push(series.maxCents);
  return out.slice(0, 2);
}

function PpvPriceChart({ points }: { points: PpvPoint[] }) {
  const width = 372;
  const height = 148;
  const padX = 32;
  const padTop = 28;
  const padBottom = 26;
  const dots = priceChartLayout(points, width, height);
  const chartTop = padTop;
  const chartBottom = height - padBottom;
  const gridYs = [0.25, 0.5, 0.75].map((ratio) => chartTop + (chartBottom - chartTop) * ratio);
  const linePoints = dots.map((dot) => `${dot.x},${dot.y}`).join(" ");
  const areaPath = dots.length > 0
    ? `M ${dots[0]!.x} ${chartBottom} L ${dots.map((dot) => `${dot.x} ${dot.y}`).join(" L ")} L ${dots[dots.length - 1]!.x} ${chartBottom} Z`
    : "";

  return (
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Gráfica de precio por fecha" className="h-[148px] w-full">
      <defs>
        <linearGradient id="ppv-area" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={CHART_GREEN} stopOpacity="0.22" />
          <stop offset="100%" stopColor={CHART_GREEN} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {gridYs.map((y) => (
        <line key={y} x1={padX} x2={width - padX} y1={y} y2={y} stroke="#e6e8ee" strokeWidth="1" />
      ))}
      {areaPath ? <path d={areaPath} fill="url(#ppv-area)" /> : null}
      {dots.length > 1 ? <polyline fill="none" stroke={CHART_GREEN} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" points={linePoints} /> : null}
      {dots.map((dot, index) => (
        <g key={`${dot.date}-${index}`}>
          <circle cx={dot.x} cy={dot.y} r="6" fill="#ffffff" stroke={CHART_GREEN} strokeWidth="2.5" />
          <text x={dot.x} y={Math.max(14, dot.y - 12)} textAnchor="middle" fontSize="11" fontWeight="600" fill={CHART_GREEN}>{dot.label}</text>
          {dot.date ? <text x={dot.x} y={height - 6} textAnchor="middle" fontSize="10" fill="#6d7585">{dot.date}</text> : null}
        </g>
      ))}
    </svg>
  );
}