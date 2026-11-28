import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Bar, BarChart, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button, Field, Panel, Select } from "@/components/ui";
import { getDashboardInsights, type DashboardInsightsView } from "@/lib/of-sessions";
import { SIN_DATOS, widgetsFor, type DashboardAudience, type DashboardConfig } from "@/lib/dashboard-config";
import { CHANNEL_LABELS, CHANNELS, CREATOR_COLUMNS, DEFAULT_CREATOR_COLUMNS, dayKey, shiftDay, type Basis, type Channel, type CreatorColumnId, type Granularity, type Kpi } from "@/lib/dashboard-insights";
import { changeText, columnKind, columnLabel, csvMoney, formatValue, greeting, moveColumn, readColumns, toCsv, WEEKDAY_SHORT, type ValueKind } from "@/lib/dashboard-format";
import { cutLabel } from "@/lib/dashboard-cuts";
import { sourceLabel } from "@/lib/sync-status";
import { formatCents } from "@/lib/format";
import { FAN_SEGMENT_IDS, segmentDetail, segmentLabel, type FanSegmentId } from "@/lib/fan-segments";
import { rememberOpenThread } from "@/lib/open-thread";
import { cn } from "@/lib/cn";

export type InsightFilters = { from: string; to: string; creatorId: string; tag: string; basis: Basis; granularity: Granularity };

const BASIS_KEY = "fanlink:dash:basis";
const COLUMNS_KEY = "fanlink:dash:columns";
const CHANNEL_COLORS: Record<Channel, string> = {
  subs: "#3b6cff",
  messages: "#7c4dff",
  tips: "#c4841d",
  posts: "#16a34a",
  referrals: "#0891b2",
  streams: "#d45656",
  other: "#8b93a1",
};
const SERIES_COLORS = ["#3b6cff", "#7c4dff", "#c4841d", "#16a34a", "#0891b2", "#d45656", "#db2777", "#475569"];
const tooltipStyle = { background: "var(--color-surface)", border: "1px solid var(--color-line)", color: "var(--color-fg)", borderRadius: 8, fontSize: 12 };

export function defaultFilters(now: Date = new Date()): InsightFilters {
  const to = dayKey(now);
  const saved = typeof localStorage === "undefined" ? null : localStorage.getItem(BASIS_KEY);
  return { from: shiftDay(to, -29), to, creatorId: "all", tag: "all", basis: saved === "gross" ? "gross" : "net", granularity: "day" };
}

export function useDashboardInsights(filters: InsightFilters, enabled = true) {
  const [view, setView] = useState<DashboardInsightsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    try {
      const next = await getDashboardInsights({ data: filters });
      setView(next);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cargar el dashboard.");
    } finally {
      setLoading(false);
    }
  }, [enabled, filters.from, filters.to, filters.creatorId, filters.tag, filters.basis, filters.granularity]);
  useEffect(() => {
    void load();
    // Solo cambia en los cortes: basta con revisar cada 10 minutos por si entró uno nuevo.
    const timer = setInterval(() => void load(), 10 * 60_000);
    return () => clearInterval(timer);
  }, [load]);
  return { view, error, loading, reload: load };
}

const PRESETS: Array<{ id: string; label: string; range: (today: string) => [string, string] }> = [
  { id: "hoy", label: "Hoy", range: (today) => [today, today] },
  { id: "ayer", label: "Ayer", range: (today) => [shiftDay(today, -1), shiftDay(today, -1)] },
  { id: "7", label: "7 días", range: (today) => [shiftDay(today, -6), today] },
  { id: "30", label: "30 días", range: (today) => [shiftDay(today, -29), today] },
  { id: "mes", label: "Este mes", range: (today) => [`${today.slice(0, 7)}-01`, today] },
  { id: "mes-pasado", label: "Mes pasado", range: (today) => {
    const first = `${today.slice(0, 7)}-01`;
    const lastPrev = shiftDay(first, -1);
    return [`${lastPrev.slice(0, 7)}-01`, lastPrev];
  } },
  { id: "90", label: "90 días", range: (today) => [shiftDay(today, -89), today] },
];

/** Neto o bruto: desplegable arriba del todo, aplica a todo el dashboard. */
export function BasisSelect({ value, onChange }: { value: Basis; onChange: (basis: Basis) => void }) {
  return (
    <Select
      aria-label="Ingresos netos o brutos"
      data-testid="basis-select"
      value={value}
      onChange={(event) => {
        const next: Basis = event.target.value === "gross" ? "gross" : "net";
        if (typeof localStorage !== "undefined") localStorage.setItem(BASIS_KEY, next);
        onChange(next);
      }}
      className="font-medium"
    >
      <option value="net">Ingresos netos</option>
      <option value="gross">Ingresos brutos</option>
    </Select>
  );
}

export function InsightsHeader({
  name,
  filters,
  onChange,
  view,
  loading,
  agency,
}: {
  name: string;
  filters: InsightFilters;
  onChange: (next: InsightFilters) => void;
  view: DashboardInsightsView | null;
  loading: boolean;
  agency: boolean;
}) {
  const today = dayKey(new Date());
  const updated = view?.updated;
  const updatedText = updated?.cutsEnabled
    ? updated.cutAt ? `Actualizado: ${cutLabel(updated.cutAt)}` : "Sin corte guardado todavía"
    : `Actualizado: ${updated?.lastReadAt ? cutLabel(updated.lastReadAt) : SIN_DATOS}`;
  return (
    <div className="space-y-3 border-b border-line bg-surface px-4 py-3" data-testid="insights-header">
      <div className="flex flex-wrap items-center gap-3">
        <BasisSelect value={filters.basis} onChange={(basis) => onChange({ ...filters, basis })} />
        <div className="min-w-0">
          <p className="font-display text-lg font-semibold">{greeting(new Date(), name)}</p>
          <p className="text-xs text-muted" data-testid="updated-at">
            {updatedText}
            {updated?.cutsEnabled && updated.nextCutAt ? ` · próximo corte ${cutLabel(updated.nextCutAt)}` : ""}
            {updated?.cutsEnabled ? " · cifras a día vencido (hoy queda abierto hasta el corte)" : ""}
            {loading ? " · cargando…" : ""}
          </p>
        </div>
      </div>
      <SourcesNotice view={view} />
      <div className="flex flex-wrap items-center gap-2" data-testid="insights-filters">
        <Select
          aria-label="Rango rápido"
          value=""
          onChange={(event) => {
            const preset = PRESETS.find((item) => item.id === event.target.value);
            if (!preset) return;
            const [from, to] = preset.range(today);
            onChange({ ...filters, from, to });
          }}
        >
          <option value="">Rango…</option>
          {PRESETS.map((preset) => (
            <option key={preset.id} value={preset.id}>{preset.label}</option>
          ))}
        </Select>
        <Field type="date" aria-label="Desde" className="w-auto" value={filters.from} max={filters.to} onChange={(event) => event.target.value && onChange({ ...filters, from: event.target.value })} />
        <span className="text-xs text-muted">a</span>
        <Field type="date" aria-label="Hasta" className="w-auto" value={filters.to} max={today} onChange={(event) => event.target.value && onChange({ ...filters, to: event.target.value })} />
        <Select aria-label="Creadora" value={filters.creatorId} onChange={(event) => onChange({ ...filters, creatorId: event.target.value })}>
          <option value="all">Todas las creadoras</option>
          {(view?.creators ?? []).map((creator) => (
            <option key={creator.id} value={creator.id}>{creator.name}</option>
          ))}
        </Select>
        <Select aria-label="Etiqueta" value={filters.tag} onChange={(event) => onChange({ ...filters, tag: event.target.value })}>
          <option value="all">Todas las etiquetas</option>
          {(view?.tags ?? []).map((tag) => (
            <option key={tag} value={tag}>{tag}</option>
          ))}
        </Select>
        <Button type="button" variant="ghost" onClick={() => onChange({ ...defaultFilters(), basis: filters.basis })}>Restablecer</Button>
      </div>
    </div>
  );
}

/**
 * Qué fuentes faltan, por creadora y por separado: chats, ingresos y fans. Que los chats vayan bien no
 * significa que haya ingresos. Sin avisos cuando todo está leído directamente de OnlyFans.
 */
function SourcesNotice({ view }: { view: DashboardInsightsView | null }) {
  if (!view) return null;
  const rows = view.sources.filter((row) => !(row.earnings.state === "ok" && !row.earnings.fallback && row.fans.state === "ok" && !row.fans.fallback && row.chats.state === "ok"));
  const noCut = view.updated.cutsEnabled && !view.updated.cutAt;
  if (rows.length === 0 && !noCut) return null;
  return (
    <div className="rounded-md border border-[#e5c97a] bg-[#fff8e6] px-3 py-2 text-xs text-[#6b4a07]" data-testid="sources-status" role="status">
      {noCut ? (
        <p data-testid="no-cut-notice">
          Todavía no hay ningún corte guardado: las cifras salen de lo último que se haya leído de cada creadora. El primer corte se hace solo al arrancar el servidor, si la cuenta está autorizada para lectura.
        </p>
      ) : null}
      {rows.length > 0 ? (
        <ul className="mt-1 space-y-1">
          {rows.map((row) => (
            <li key={row.creatorId} data-testid="source-row" data-creator={row.name}>
              <span className="font-medium">{row.name}</span>
              {": "}
              <span>Chats sincronizados: {sourceLabel(row.chats)}</span>
              {" · "}
              <span>Ingresos sincronizados: {sourceLabel(row.earnings)}</span>
              {" · "}
              <span>Fans: {sourceLabel(row.fans)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

// ---------- piezas ----------

function Spark({ values, color = "var(--color-primary)" }: { values: Array<number | null>; color?: string }) {
  const nums = values.map((value) => value ?? 0);
  if (nums.length < 2 || nums.every((value) => value === 0)) return <div className="h-8" />;
  const max = Math.max(...nums);
  const min = Math.min(...nums);
  const span = max - min || 1;
  const points = nums.map((value, index) => `${(index / (nums.length - 1)) * 100},${30 - ((value - min) / span) * 28}`).join(" ");
  return (
    <svg viewBox="0 0 100 32" preserveAspectRatio="none" className="h-8 w-full" aria-hidden>
      <polyline points={points} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function KpiCard({ label, kpi, kind, hint }: { label: string; kpi: Kpi; kind: ValueKind; hint?: string }) {
  const change = changeText(kpi.change);
  return (
    <article className="rounded-lg border border-line bg-surface p-4" data-testid="kpi-card">
      <p className="text-xs text-muted">{label}</p>
      <div className="mt-1 flex items-baseline gap-2">
        <p className="font-display text-2xl font-semibold tabular-nums">{formatValue(kind, kpi.value)}</p>
        {change ? <span className={cn("text-xs font-medium", (kpi.change ?? 0) >= 0 ? "text-[#137333]" : "text-danger")}>{change}</span> : null}
      </div>
      <Spark values={kpi.spark} />
      {hint ? <p className="text-[11px] text-muted">{hint}</p> : null}
    </article>
  );
}

function Empty({ text = SIN_DATOS }: { text?: string }) {
  return <p className="text-sm text-muted">{text}</p>;
}

function Donut({ rows, center }: { rows: Array<{ label: string; value: number; color: string; text: string }>; center: string }) {
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  if (rows.length === 0 || total <= 0) return <Empty />;
  return (
    <div className="flex flex-wrap items-center gap-4">
      <div className="relative h-44 w-44 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={rows} dataKey="value" nameKey="label" innerRadius="62%" outerRadius="100%" stroke="none" isAnimationActive={false}>
              {rows.map((row) => (
                <Cell key={row.label} fill={row.color} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-center">
          <span className="font-display text-sm font-semibold tabular-nums">{center}</span>
        </div>
      </div>
      <ul className="min-w-40 flex-1 space-y-2 text-sm">
        {rows.map((row) => (
          <li key={row.label} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: row.color }} />
            <span className="flex-1 truncate">{row.label}</span>
            <span className="tabular-nums font-medium">{row.text}</span>
            <span className="w-14 text-right text-xs text-muted tabular-nums">{((row.value / total) * 100).toFixed(1).replace(".", ",")} %</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Heatmap({ grid, format }: { grid: number[][] | null; format: (value: number) => string }) {
  if (!grid) return <Empty />;
  const max = Math.max(1, ...grid.flat());
  return (
    <div className="overflow-x-auto" data-testid="heatmap">
      <table className="border-separate border-spacing-0.5 text-[10px]">
        <thead>
          <tr>
            <th />
            {Array.from({ length: 24 }, (_, hour) => (
              <th key={hour} className="w-6 font-normal text-muted">{hour}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grid.map((row, day) => (
            <tr key={WEEKDAY_SHORT[day]}>
              <th className="pr-1 text-right font-normal text-muted">{WEEKDAY_SHORT[day]}</th>
              {row.map((value, hour) => (
                <td
                  key={hour}
                  title={`${WEEKDAY_SHORT[day]} ${hour}:00 · ${format(value)}`}
                  className="h-5 w-6 rounded-sm"
                  style={{ background: value === 0 ? "var(--color-raised)" : `color-mix(in srgb, var(--color-primary) ${Math.round(15 + (value / max) * 85)}%, transparent)` }}
                />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function download(name: string, text: string) {
  const blob = new Blob([`\ufeff${text}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function useOpenChat() {
  const navigate = useNavigate();
  return (creatorId: string, fanKey: string) => {
    rememberOpenThread({ creatorId, threadKey: null, fanKey });
    void navigate({ to: "/mensajes" });
  };
}

function visibleIds(config: DashboardConfig, screen: Parameters<typeof widgetsFor>[1], audience: DashboardAudience): Set<string> {
  return new Set(widgetsFor(config, screen, audience).map((widget) => widget.id));
}

// ---------- Resumen ----------

export function ResumenScreen({ view, config, audience, filters, onFilters }: { view: DashboardInsightsView; config: DashboardConfig; audience: DashboardAudience; filters: InsightFilters; onFilters: (next: InsightFilters) => void }) {
  const show = visibleIds(config, "resumen", audience);
  const [heatMode, setHeatMode] = useState<"revenue" | "activity">("revenue");
  const openChat = useOpenChat();
  if (!view.agency) return <MineScreen view={view} show={show} />;
  const summary = view.summary;
  if (!summary) return <Empty />;
  const k = summary.kpis;
  const cards: Array<{ id: string; label: string; kpi: Kpi; kind: ValueKind; hint?: string }> = [
    { id: "ingresos", label: "Facturación total", kpi: k.total, kind: "money" },
    { id: "suscripciones", label: "Suscripciones", kpi: k.subs, kind: "money" },
    { id: "ppv", label: "Mensajes y PPV", kpi: k.messages, kind: "money" },
    { id: "tips", label: "Propinas", kpi: k.tips, kind: "money" },
    { id: "posts", label: "Posts", kpi: k.posts, kind: "money" },
    { id: "referidos", label: "Referidos", kpi: k.referrals, kind: "money" },
    { id: "directos", label: "Directos", kpi: k.streams, kind: "money" },
    { id: "fans-activos", label: "Fans activos", kpi: k.activeFans, kind: "number" },
    { id: "nuevos-subs", label: "Suscriptores nuevos", kpi: k.newSubs, kind: "number" },
    { id: "compras", label: "Compras", kpi: k.purchases, kind: "number" },
    { id: "fans-online", label: "Fans online", kpi: k.fansOnline, kind: "number", hint: "Última lectura del corte" },
    { id: "mensajes", label: "Mensajes enviados", kpi: k.messagesSent, kind: "number" },
  ];
  const money = (cents: number) => formatCents(cents);
  return (
    <div className="space-y-4" data-testid="resumen-agency">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
        {cards.filter((card) => show.has(card.id)).map((card) => (
          <KpiCard key={card.id} label={card.label} kpi={card.kpi} kind={card.kind} hint={card.hint} />
        ))}
      </div>
      {show.has("alertas") ? <AlertsPanel view={view} /> : null}
      {show.has("tendencia") ? (
        <Panel
          title="Ingresos"
          action={
            <div className="flex gap-1 rounded-md border border-line p-0.5" role="group" aria-label="Agrupar por">
              {(["hour", "day", "week", "month"] as Granularity[]).map((item) => (
                <button key={item} type="button" onClick={() => onFilters({ ...filters, granularity: item })} className={cn("rounded px-2 py-0.5 text-xs", filters.granularity === item ? "bg-primary text-primary-fg" : "text-muted")}>
                  {item === "hour" ? "Hora" : item === "day" ? "Día" : item === "week" ? "Semana" : "Mes"}
                </button>
              ))}
            </div>
          }
          bodyClass="h-64"
        >
          {summary.series.length === 0 ? <Empty /> : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={summary.series}>
                <XAxis dataKey="label" tick={{ fill: "var(--color-muted)", fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={16} />
                <YAxis hide />
                <Tooltip formatter={(value) => [money(Number(value)), filters.basis === "net" ? "Neto" : "Bruto"]} contentStyle={tooltipStyle} />
                <Bar dataKey="cents" radius={6} isAnimationActive={false}>
                  {summary.series.map((point) => (
                    <Cell key={point.label} fill={point.partial ? "color-mix(in srgb, var(--color-primary) 45%, transparent)" : "var(--color-primary)"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </Panel>
      ) : null}
      <div className="grid gap-4 xl:grid-cols-2">
        {show.has("canales") ? (
          <Panel title="Ingresos por canal" bodyClass="h-64">
            {!summary.hasSales ? <Empty /> : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={summary.byChannel}>
                  <XAxis dataKey="label" tick={{ fill: "var(--color-muted)", fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={16} />
                  <YAxis hide />
                  <Tooltip formatter={(value, key) => [money(Number(value)), CHANNEL_LABELS[key as Channel] ?? String(key)]} contentStyle={tooltipStyle} />
                  <Legend formatter={(key) => CHANNEL_LABELS[key as Channel] ?? key} wrapperStyle={{ fontSize: 11 }} />
                  {CHANNELS.filter((channel) => summary.breakdown.some((row) => row.channel === channel)).map((channel) => (
                    <Line key={channel} type="monotone" dataKey={channel} stroke={CHANNEL_COLORS[channel]} dot={false} strokeWidth={2} isAnimationActive={false} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            )}
          </Panel>
        ) : null}
        {show.has("reparto") ? (
          <Panel title="Reparto de ingresos">
            <Donut
              center={formatValue("money", k.total.value)}
              rows={summary.breakdown.map((row) => ({ label: CHANNEL_LABELS[row.channel], value: row.cents, color: CHANNEL_COLORS[row.channel], text: money(row.cents) }))}
            />
          </Panel>
        ) : null}
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        {show.has("mejor-dia") ? (
          <Panel title="Mejor día" bodyClass="h-56">
            {!summary.bestDay ? <Empty /> : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={summary.bestDay.totals.map((cents, index) => ({ label: WEEKDAY_SHORT[index], cents, best: index === summary.bestDay?.best }))}>
                  <XAxis dataKey="label" tick={{ fill: "var(--color-muted)", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis hide />
                  <Tooltip formatter={(value) => [money(Number(value)), "Ingresos"]} contentStyle={tooltipStyle} />
                  <Bar dataKey="cents" radius={6} isAnimationActive={false}>
                    {summary.bestDay.totals.map((_, index) => (
                      <Cell key={WEEKDAY_SHORT[index]} fill={index === summary.bestDay?.best ? "var(--color-gold)" : "color-mix(in srgb, var(--color-primary) 55%, transparent)"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </Panel>
        ) : null}
        {show.has("mejor-hora") ? (
          <Panel title="Mejor hora">
            {!summary.bestHour || summary.bestHour.best == null ? <Empty /> : (
              <div>
                <p className="font-display text-3xl font-semibold">{String(summary.bestHour.best).padStart(2, "0")}:00–{String((summary.bestHour.best + 1) % 24).padStart(2, "0")}:00</p>
                <p className="mt-1 text-sm text-muted">{money(summary.bestHour.totals[summary.bestHour.best] ?? 0)} en esa franja (hora de Madrid)</p>
                <div className="mt-3 flex h-16 items-end gap-0.5">
                  {summary.bestHour.totals.map((value, hour) => (
                    <div key={hour} title={`${hour}:00 · ${money(value)}`} className="flex-1 rounded-t-sm" style={{ height: `${Math.max(4, (value / Math.max(1, ...summary.bestHour!.totals)) * 100)}%`, background: hour === summary.bestHour?.best ? "var(--color-gold)" : "var(--color-line)" }} />
                  ))}
                </div>
              </div>
            )}
          </Panel>
        ) : null}
        {show.has("clv") ? (
          <Panel title="Valor medio por suscriptor (CLV)">
            {!summary.clv ? <Empty /> : (
              <div>
                <p className="font-display text-3xl font-semibold tabular-nums">{money(summary.clv.cents)}</p>
                <p className="mt-1 text-sm text-muted">Ingresos del rango entre la media de suscriptores ({formatValue("number", summary.clv.avgSubscribers)}).</p>
              </div>
            )}
          </Panel>
        ) : null}
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        {show.has("top-fans") ? (
          <Panel title="Top fans">
            {summary.topFans.length === 0 ? <Empty /> : (
              <table className="w-full text-sm" data-testid="top-fans">
                <thead className="text-left text-xs text-muted">
                  <tr><th className="pb-2">Fan</th><th className="pb-2 text-right">Compras</th><th className="pb-2 text-right">Gasto en el rango</th><th className="pb-2 text-right">Gasto total</th><th /></tr>
                </thead>
                <tbody>
                  {summary.topFans.map((fan) => (
                    <tr key={`${fan.creatorId}:${fan.fanKey}`} className="border-t border-line">
                      <td className="py-2">{fan.name}<span className="ml-1 text-xs text-muted">· {fan.creatorName}</span></td>
                      <td className="py-2 text-right tabular-nums">{fan.purchases}</td>
                      <td className="py-2 text-right tabular-nums">{money(fan.cents)}</td>
                      <td className="py-2 text-right tabular-nums">{formatValue("money", fan.lifetimeCents)}</td>
                      <td className="py-2 text-right"><Button type="button" variant="ghost" className="px-2 py-1 text-xs" onClick={() => openChat(fan.creatorId, fan.fanKey)}>Ir al chat</Button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
        ) : null}
        {show.has("heatmap") ? (
          <Panel
            title="Mapa de calor"
            action={
              <Select aria-label="Modo del mapa de calor" value={heatMode} onChange={(event) => setHeatMode(event.target.value === "activity" ? "activity" : "revenue")} className="py-1 text-xs">
                <option value="revenue">Ingresos</option>
                <option value="activity">Actividad de fans</option>
              </Select>
            }
          >
            <Heatmap
              grid={heatMode === "revenue" ? summary.heatmap.revenue : summary.heatmap.activity}
              format={(value) => (heatMode === "revenue" ? money(value) : `${value} mensajes`)}
            />
          </Panel>
        ) : null}
      </div>
    </div>
  );
}

function MineScreen({ view, show }: { view: DashboardInsightsView; show: Set<string> }) {
  const mine = view.mine;
  return (
    <div className="space-y-4" data-testid="resumen-chatter">
      <p className="text-sm text-muted">Tus números: ventas que te atribuye el CRM, tus PPV y tus chats. Los totales de la agencia no se muestran.</p>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
        <KpiCard label="Mis ventas atribuidas" kpi={{ value: mine?.salesCents ?? null, previous: null, change: mine?.salesChange ?? null, spark: mine?.series.map((row) => row.cents) ?? [] }} kind="money" />
        <KpiCard label="PPV enviados" kpi={{ value: mine?.ppvSent ?? null, previous: null, change: null, spark: [] }} kind="number" />
        <KpiCard label="PPV comprados" kpi={{ value: mine?.ppvBought ?? null, previous: null, change: null, spark: [] }} kind="number" />
        <KpiCard label="Conversión de PPV" kpi={{ value: mine?.conversion ?? null, previous: null, change: null, spark: [] }} kind="ratio" />
        <KpiCard label="Tiempo de respuesta" kpi={{ value: mine?.replyMinutes ?? null, previous: null, change: null, spark: [] }} kind="minutes" />
        <KpiCard label="Fans chateados" kpi={{ value: mine?.fansChatted ?? null, previous: null, change: null, spark: [] }} kind="number" />
        <KpiCard label="Mensajes enviados" kpi={{ value: mine?.messagesSent ?? null, previous: null, change: null, spark: [] }} kind="number" />
      </div>
      {show.has("alertas") ? <AlertsPanel view={view} /> : null}
    </div>
  );
}

export function AlertsPanel({ view }: { view: DashboardInsightsView }) {
  const navigate = useNavigate();
  const [kind, setKind] = useState<string>("all");
  const kinds = [...new Set(view.alerts.map((alert) => alert.kind))];
  const list = view.alerts.filter((alert) => kind === "all" || alert.kind === kind);
  const kindLabel: Record<string, string> = { session: "Sesión", sync: "Lectura", drop: "Bajada de ingresos", whale: "Fan que gasta mucho", shift: "Turnos" };
  return (
    <Panel
      title={`Alertas${view.alerts.length > 0 ? ` (${view.alerts.length})` : ""}`}
      action={kinds.length > 1 ? (
        <Select aria-label="Filtrar alertas" value={kind} onChange={(event) => setKind(event.target.value)} className="py-1 text-xs">
          <option value="all">Todas</option>
          {kinds.map((item) => <option key={item} value={item}>{kindLabel[item] ?? item}</option>)}
        </Select>
      ) : undefined}
    >
      {list.length === 0 ? <p className="text-sm text-muted">Sin alertas</p> : (
        <ul className="space-y-2 text-sm" data-testid="alerts">
          {list.map((alert) => (
            <li key={`${alert.kind}:${alert.text}`} className="flex flex-wrap items-center gap-2">
              <span className={cn("rounded-sm px-1.5 py-0.5 text-[11px] font-medium", alert.level === "alta" ? "bg-danger/15 text-danger" : "bg-gold/15 text-gold")}>{kindLabel[alert.kind] ?? alert.kind}</span>
              <span className="flex-1">{alert.text}</span>
              {alert.action ? (
                <Button type="button" variant="soft" className="px-2 py-1 text-xs" onClick={() => {
                  if (alert.action?.thread) rememberOpenThread({ creatorId: alert.action.thread.creatorId, threadKey: null, fanKey: alert.action.thread.fanKey });
                  if (alert.action?.href.startsWith("/#")) window.location.hash = alert.action.href.slice(2);
                  else void navigate({ href: alert.action?.href ?? "/" });
                }}>{alert.action.label}</Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

// ---------- Creadoras ----------

export function CreadorasScreen({ view, config, audience }: { view: DashboardInsightsView; config: DashboardConfig; audience: DashboardAudience }) {
  const show = visibleIds(config, "creadoras", audience);
  const [columns, setColumns] = useState<CreatorColumnId[]>(() => readColumns(typeof localStorage === "undefined" ? null : safeJson(localStorage.getItem(COLUMNS_KEY)), DEFAULT_CREATOR_COLUMNS));
  const [sort, setSort] = useState<{ id: CreatorColumnId | "name"; dir: 1 | -1 }>({ id: "total", dir: -1 });
  const [picking, setPicking] = useState(false);
  const table = view.creatorTable;
  if (!view.agency || !table) return <p className="text-sm text-muted">La tabla por creadora la ven la dueña, Admin y Supervisor.</p>;
  const save = (next: CreatorColumnId[]) => {
    setColumns(next);
    if (typeof localStorage !== "undefined") localStorage.setItem(COLUMNS_KEY, JSON.stringify(next));
  };
  const rows = [...table.rows].sort((a, b) => {
    if (sort.id === "name") return a.name.localeCompare(b.name) * sort.dir;
    return ((a.values[sort.id] ?? -Infinity) - (b.values[sort.id] ?? -Infinity)) * sort.dir;
  });
  const exportCreators = () => download(`creadoras-${view.query.from}_${view.query.to}.csv`, toCsv(
    ["Creadora", ...columns.map(columnLabel)],
    rows.map((row) => [row.name, ...columns.map((id) => (columnKind(id) === "money" ? csvMoney(row.values[id]) : row.values[id]))]),
  ));
  const daily = view.daily ?? [];
  return (
    <div className="space-y-4">
      {show.has("creadoras-cuentas") ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Creadoras" value={String(table.cards.creators)} />
          <Stat label="Ingresos por mensajes" value={formatValue("money", table.cards.messageCents)} />
          <Stat label="Ingresos totales" value={formatValue("money", table.cards.totalCents)} />
          <Stat label="Reembolsos" value={formatValue("money", table.cards.refundCents)} hint="OnlyFans no da los reembolsos en lo que se lee hoy." />
        </div>
      ) : null}
      {show.has("creadoras-ingresos") ? (
        <Panel
          title="Estadísticas por creadora"
          action={
            <div className="flex gap-2">
              <Button type="button" variant="soft" onClick={() => setPicking((open) => !open)}>Métricas personalizadas</Button>
              <Button type="button" variant="soft" onClick={exportCreators}>Exportar CSV</Button>
            </div>
          }
        >
          {picking ? (
            <div className="mb-4 rounded-md border border-line p-3" data-testid="column-picker">
              <p className="mb-2 text-xs text-muted">Marca las columnas y ordénalas con las flechas.</p>
              <ul className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
                {[...columns, ...CREATOR_COLUMNS.map((column) => column.id).filter((id) => !columns.includes(id))].map((id) => {
                  const on = columns.includes(id);
                  return (
                    <li key={id} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" className="h-4 w-4 accent-primary" checked={on} aria-label={columnLabel(id)} onChange={(event) => save(event.target.checked ? [...columns, id] : columns.filter((item) => item !== id))} />
                      <span className="flex-1">{columnLabel(id)}</span>
                      {on ? (
                        <>
                          <button type="button" className="px-1 text-muted" aria-label={`Subir ${columnLabel(id)}`} onClick={() => save(moveColumn(columns, id, -1))}>↑</button>
                          <button type="button" className="px-1 text-muted" aria-label={`Bajar ${columnLabel(id)}`} onClick={() => save(moveColumn(columns, id, 1))}>↓</button>
                        </>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm" data-testid="creator-stats">
              <thead className="text-left text-xs text-muted">
                <tr>
                  <SortHeader label="Creadora" active={sort.id === "name"} dir={sort.dir} onClick={() => setSort({ id: "name", dir: sort.id === "name" ? (sort.dir === 1 ? -1 : 1) : 1 })} />
                  {columns.map((id) => (
                    <SortHeader key={id} label={columnLabel(id)} align="right" active={sort.id === id} dir={sort.dir} onClick={() => setSort({ id, dir: sort.id === id ? (sort.dir === 1 ? -1 : 1) : -1 })} />
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.creatorId} className="border-t border-line">
                    <td className="py-2 font-medium">{row.name}{row.tag ? <span className="ml-1 text-xs text-muted">· {row.tag}</span> : null}</td>
                    {columns.map((id) => {
                      const change = changeText(row.changes[id]);
                      return (
                        <td key={id} className="py-2 text-right tabular-nums">
                          <span className={row.values[id] == null ? "text-muted" : ""}>{formatValue(columnKind(id), row.values[id])}</span>
                          {change ? <span className={cn("block text-[10px]", (row.changes[id] ?? 0) >= 0 ? "text-[#137333]" : "text-danger")}>{change}</span> : null}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      ) : null}
      {show.has("comparativa") ? (
        <Panel
          title="Comparativa detallada"
          action={<Button type="button" variant="soft" onClick={() => download(`comparativa-${view.query.from}_${view.query.to}.csv`, toCsv(
            ["Fecha", "Total", "Subs nuevas", "Ingresos subs nuevas", "Recurrentes", "Propinas", "Mensajes", "Ratio chat vs subs", "Clics", "Conversión"],
            daily.map((row) => [row.day, csvMoney(row.totalCents), row.newSubs, csvMoney(row.newSubsCents), csvMoney(row.recurringCents), csvMoney(row.tipsCents), csvMoney(row.messagesCents), row.chatVsSubs == null ? null : row.chatVsSubs.toFixed(2), row.clicks, row.conversion == null ? null : row.conversion.toFixed(3)]),
          ))}>Exportar CSV</Button>}
        >
          <div className="max-h-[420px] overflow-auto">
            <table className="w-full min-w-[820px] text-sm" data-testid="daily-table">
              <thead className="sticky top-0 bg-surface text-left text-xs text-muted">
                <tr>
                  {["Fecha", "Total", "Subs nuevas", "Ingresos subs nuevas", "Recurrentes", "Propinas", "Mensajes", "Chat vs subs", "Clics", "Conversión"].map((label, index) => (
                    <th key={label} className={cn("pb-2", index > 0 && "text-right")}>{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {daily.map((row) => (
                  <tr key={row.day} className="border-t border-line">
                    <td className="py-1.5">{row.day}{row.partial ? <span className="ml-1 text-[10px] text-muted">(abierto)</span> : null}</td>
                    <td className="py-1.5 text-right tabular-nums">{formatValue("money", row.totalCents)}</td>
                    <td className="py-1.5 text-right tabular-nums">{formatValue("number", row.newSubs)}</td>
                    <td className="py-1.5 text-right tabular-nums">{formatValue("money", row.newSubsCents)}</td>
                    <td className="py-1.5 text-right tabular-nums">{formatValue("money", row.recurringCents)}</td>
                    <td className="py-1.5 text-right tabular-nums">{formatValue("money", row.tipsCents)}</td>
                    <td className="py-1.5 text-right tabular-nums">{formatValue("money", row.messagesCents)}</td>
                    <td className="py-1.5 text-right tabular-nums">{row.chatVsSubs == null ? SIN_DATOS : row.chatVsSubs.toFixed(2).replace(".", ",")}</td>
                    <td className="py-1.5 text-right tabular-nums">{formatValue("number", row.clicks)}</td>
                    <td className="py-1.5 text-right tabular-nums">{formatValue("ratio", row.conversion)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      ) : null}
    </div>
  );
}

function SortHeader({ label, active, dir, onClick, align }: { label: string; active: boolean; dir: 1 | -1; onClick: () => void; align?: "right" }) {
  return (
    <th className={cn("pb-2 font-medium", align === "right" && "text-right")}>
      <button type="button" onClick={onClick} className={cn("inline-flex items-center gap-1", active && "text-fg")}>
        {label}{active ? (dir === 1 ? " ↑" : " ↓") : ""}
      </button>
    </th>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <article className="rounded-lg border border-line bg-surface p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-2 font-display text-2xl font-semibold tabular-nums">{value}</p>
      {hint ? <p className="mt-1 text-[11px] text-muted">{hint}</p> : null}
    </article>
  );
}

function safeJson(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// ---------- Rendimiento ----------

export function RendimientoScreen({ view, filters }: { view: DashboardInsightsView; filters: InsightFilters }) {
  const [search, setSearch] = useState("");
  const [chosen, setChosen] = useState<string | null>(null);
  const list = view.creators.filter((creator) => creator.name.toLowerCase().includes(search.trim().toLowerCase()));
  const current = chosen && view.creators.some((creator) => creator.id === chosen) ? chosen : view.creators[0]?.id ?? null;
  const single = useMemo(() => ({ ...filters, creatorId: current ?? "all", tag: "all" }), [filters, current]);
  const one = useDashboardInsights(single, Boolean(current) && view.agency);
  if (!view.agency) return <p className="text-sm text-muted">El rendimiento por creadora lo ven la dueña, Admin y Supervisor.</p>;
  const summary = one.view?.summary ?? null;
  return (
    <div className="flex flex-col gap-4 lg:flex-row" data-testid="rendimiento">
      <aside className="rounded-lg border border-line bg-surface p-3 lg:w-60 lg:shrink-0">
        <Field placeholder="Buscar creadora" aria-label="Buscar creadora" value={search} onChange={(event) => setSearch(event.target.value)} />
        <ul className="mt-2 space-y-1">
          {list.map((creator) => (
            <li key={creator.id}>
              <button type="button" onClick={() => setChosen(creator.id)} className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm", creator.id === current ? "bg-primary/10 text-primary" : "hover:bg-raised")}>
                <span className={cn("h-2 w-2 rounded-full", creator.online != null && creator.online > 0 ? "bg-[#16a34a]" : "bg-line")} title={creator.online == null ? "Fans online: Sin datos" : `${creator.online} fans online`} />
                <span className="flex-1 truncate">{creator.name}</span>
                {creator.tag ? <span className="text-[10px] text-muted">{creator.tag}</span> : null}
              </button>
            </li>
          ))}
          {list.length === 0 ? <li className="px-2 text-sm text-muted">Sin creadoras</li> : null}
        </ul>
      </aside>
      <div className="min-w-0 flex-1 space-y-4">
        {!summary ? <Empty text={one.loading ? "Cargando…" : SIN_DATOS} /> : (
          <>
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
              <KpiCard label="Total" kpi={summary.kpis.total} kind="money" />
              {(["subs", "messages", "tips"] as const).map((channel) => (
                <KpiCard key={channel} label={CHANNEL_LABELS[channel]} kpi={summary.kpis[channel]} kind="money" />
              ))}
            </div>
            <div className="grid gap-4 xl:grid-cols-2">
              <Panel title="Ingresos por canal" bodyClass="h-64">
                {!summary.hasSales ? <Empty /> : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={summary.byChannel}>
                      <XAxis dataKey="label" tick={{ fill: "var(--color-muted)", fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={16} />
                      <YAxis hide />
                      <Tooltip formatter={(value, key) => [formatCents(Number(value)), CHANNEL_LABELS[key as Channel] ?? String(key)]} contentStyle={tooltipStyle} />
                      {CHANNELS.map((channel) => <Bar key={channel} dataKey={channel} stackId="a" fill={CHANNEL_COLORS[channel]} isAnimationActive={false} />)}
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </Panel>
              <Panel title="Reparto">
                <Donut center={formatValue("money", summary.kpis.total.value)} rows={summary.breakdown.map((row) => ({ label: CHANNEL_LABELS[row.channel], value: row.cents, color: CHANNEL_COLORS[row.channel], text: formatCents(row.cents) }))} />
                <div className="mt-3 grid grid-cols-3 gap-2">
                  {(["subs", "messages", "tips"] as const).map((channel) => (
                    <div key={channel}>
                      <p className="text-[11px] text-muted">{CHANNEL_LABELS[channel]}</p>
                      <Spark values={summary.kpis[channel].spark} color={CHANNEL_COLORS[channel]} />
                    </div>
                  ))}
                </div>
              </Panel>
            </div>
            <Panel title="Mapa de calor de ingresos">
              <Heatmap grid={summary.heatmap.revenue} format={(value) => formatCents(value)} />
            </Panel>
          </>
        )}
      </div>
    </div>
  );
}

// ---------- Chatters ----------

export function ChattersScreen({ view, config, audience }: { view: DashboardInsightsView; config: DashboardConfig; audience: DashboardAudience }) {
  const show = visibleIds(config, "chatters", audience);
  const c = view.chatters;
  const ids = c.rows.map((row) => row.userId);
  const nameOf = new Map(c.rows.map((row) => [row.userId, row.name]));
  const shiftText: Record<string, string> = { on: "En turno", late: "Retraso (+10 min)", idle: "En turno, sin conexión", absent: "Ausente" };
  return (
    <div className="space-y-4">
      {show.has("chatters-turnos") || !view.agency ? (
        <Panel title="Turnos ahora">
          {c.shifts.length === 0 ? <p className="text-sm text-muted">Nadie tiene turno ahora.</p> : (
            <ul className="flex flex-wrap gap-2 text-sm" data-testid="shifts-now">
              {c.shifts.map((row) => (
                <li key={row.userId} className={cn("rounded-full px-3 py-1", row.status === "on" ? "bg-[#16a34a]/15 text-[#137333]" : row.status === "late" || row.status === "absent" ? "bg-danger/15 text-danger" : "bg-raised text-muted")}>
                  {row.name} · {row.label} · {shiftText[row.status]}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      ) : null}
      {show.has("chatters-ventas") ? (
        <Panel title={view.agency ? "Ranking de chatters" : "Tus cifras"}>
          {c.rows.length === 0 ? <Empty /> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm" data-testid="chatter-ranking">
                <thead className="text-left text-xs text-muted">
                  <tr>
                    <th className="pb-2">#</th><th className="pb-2">Chatter</th>
                    {["Ventas atribuidas", "PPV enviados", "PPV comprados", "Conversión", "Respuesta", "Fans chateados", "Mensajes", "Horas de turno"].map((label) => <th key={label} className="pb-2 text-right">{label}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {c.rows.map((row, index) => (
                    <tr key={row.userId} className="border-t border-line">
                      <td className="py-2 text-muted">{index + 1}</td>
                      <td className="py-2 font-medium">{row.name}</td>
                      <td className="py-2 text-right tabular-nums">{formatValue("money", row.salesCents)}</td>
                      <td className="py-2 text-right tabular-nums">{formatValue("number", row.ppvSent)}</td>
                      <td className="py-2 text-right tabular-nums">{formatValue("number", row.ppvBought)}</td>
                      <td className="py-2 text-right tabular-nums">{formatValue("ratio", row.conversion)}</td>
                      <td className="py-2 text-right tabular-nums">{formatValue("minutes", row.replyMinutes)}</td>
                      <td className="py-2 text-right tabular-nums">{formatValue("number", row.fansChatted)}</td>
                      <td className="py-2 text-right tabular-nums">{formatValue("number", row.messagesSent)}</td>
                      <td className="py-2 text-right tabular-nums">{formatValue("number", row.shiftHours)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {view.agency && c.unattributedCents ? <p className="mt-2 text-xs text-muted">Sin chatter (mensajes sin autor en el CRM): {formatCents(c.unattributedCents)}</p> : null}
            </div>
          )}
        </Panel>
      ) : null}
      {show.has("chatters-respuesta") ? (
        <div className="grid gap-4 xl:grid-cols-2">
          <Panel title="Ingresos por chatter" bodyClass="h-64">
            {ids.length === 0 || c.top.length === 0 ? <Empty /> : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={c.series}>
                  <XAxis dataKey="label" tick={{ fill: "var(--color-muted)", fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={16} />
                  <YAxis hide />
                  <Tooltip formatter={(value, key) => [formatCents(Number(value)), nameOf.get(String(key)) ?? String(key)]} contentStyle={tooltipStyle} />
                  <Legend formatter={(key) => nameOf.get(String(key)) ?? key} wrapperStyle={{ fontSize: 11 }} />
                  {ids.map((id, index) => <Line key={id} type="monotone" dataKey={id} stroke={SERIES_COLORS[index % SERIES_COLORS.length]} dot={false} strokeWidth={2} isAnimationActive={false} />)}
                </LineChart>
              </ResponsiveContainer>
            )}
          </Panel>
          <Panel title="Top chatters">
            <Donut
              center={view.agency ? formatValue("money", c.totalCents) : formatValue("money", c.top[0]?.cents ?? null)}
              rows={c.top.map((row, index) => ({ label: row.name, value: row.cents, color: SERIES_COLORS[index % SERIES_COLORS.length] ?? "#3b6cff", text: formatCents(row.cents) }))}
            />
          </Panel>
        </div>
      ) : null}
    </div>
  );
}

// ---------- Suscriptores nuevos ----------

export function NuevosScreen({ view, config, audience }: { view: DashboardInsightsView; config: DashboardConfig; audience: DashboardAudience }) {
  const show = visibleIds(config, "nuevos", audience);
  const n = view.newSubs;
  const [mode, setMode] = useState<"active" | "expired">("active");
  return (
    <div className="space-y-4" data-testid="nuevos">
      <p className="text-sm text-muted">Suscriptores nuevos en el rango: <span className="font-medium text-fg">{formatValue("number", n.count)}</span></p>
      <div className="grid gap-4 xl:grid-cols-2">
        {show.has("nuevos-bienvenida") ? (
          <Panel title="Respuesta al mensaje de bienvenida">
            {!n.welcome ? <Empty /> : (
              <div className="grid grid-cols-3 gap-3">
                <Stat label="Tiempo medio de respuesta" value={formatValue("minutes", n.welcome.avgMinutes)} />
                <Stat label="Interactuaron" value={formatValue("ratio", n.welcome.interactionRate)} hint={`${n.welcome.replied} contestaron`} />
                <Stat label="Sin contestar" value={String(n.welcome.waiting)} />
              </div>
            )}
          </Panel>
        ) : null}
        {show.has("nuevos-compra") ? (
          <Panel title="Compraron / no compraron">
            {!n.purchase ? <Empty /> : (
              <Donut
                center={formatValue("ratio", n.purchase.ratio)}
                rows={[
                  { label: "Compraron", value: n.purchase.bought, color: "#16a34a", text: String(n.purchase.bought) },
                  { label: "No compraron", value: n.purchase.notBought, color: "#e6e8ee", text: String(n.purchase.notBought) },
                ]}
              />
            )}
          </Panel>
        ) : null}
        {show.has("nuevos-duracion") ? (
          <Panel
            title="Duración de la suscripción"
            action={
              <Select aria-label="Activos o dados de baja" value={mode} onChange={(event) => setMode(event.target.value === "expired" ? "expired" : "active")} className="py-1 text-xs">
                <option value="active">Activos</option>
                <option value="expired">Dados de baja</option>
              </Select>
            }
            bodyClass="h-56"
          >
            {!n.duration ? <Empty /> : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={n.duration.buckets.map((label, index) => ({ label, value: (mode === "active" ? n.duration!.active : n.duration!.expired)[index] ?? 0 }))}>
                  <XAxis dataKey="label" tick={{ fill: "var(--color-muted)", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis hide />
                  <Tooltip formatter={(value) => [String(value), "Fans"]} contentStyle={tooltipStyle} />
                  <Bar dataKey="value" fill="var(--color-primary)" radius={6} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </Panel>
        ) : null}
        {show.has("nuevos-segmentos") ? (
          <Panel title="Conversión a cada segmento">
            {!n.segments ? <Empty /> : (
              <ul className="space-y-2 text-sm">
                {n.segments.map((row) => (
                  <li key={row.id} className="flex items-center gap-2">
                    <span className="w-28 font-medium">{segmentLabel(row.id)}</span>
                    <div className="h-2 flex-1 rounded-full bg-raised"><div className="h-2 rounded-full bg-primary" style={{ width: `${n.count ? (row.count / n.count) * 100 : 0}%` }} /></div>
                    <span className="w-24 text-right tabular-nums">{row.count} · {n.count ? formatValue("ratio", row.count / n.count) : SIN_DATOS}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        ) : null}
      </div>
    </div>
  );
}

// ---------- Segmentos ----------

export function SegmentosScreen({ view, config, audience }: { view: DashboardInsightsView; config: DashboardConfig; audience: DashboardAudience }) {
  const show = visibleIds(config, "segmentos", audience);
  const [segment, setSegment] = useState<FanSegmentId>("whale");
  const openChat = useOpenChat();
  const counts = view.segments.counts;
  const fans = view.segments.fans.filter((fan) => fan.segments.includes(segment));
  return (
    <div className="space-y-4" data-testid="segmentos">
      {show.has("fans-segmentos") ? (
        counts == null ? <Empty /> : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            {FAN_SEGMENT_IDS.map((id) => (
              <button key={id} type="button" onClick={() => setSegment(id)} className={cn("rounded-lg border bg-surface p-4 text-left", segment === id ? "border-primary ring-1 ring-primary" : "border-line")} data-testid={`segment-${id}`}>
                <p className="text-xs text-muted">{segmentLabel(id)}</p>
                <p className="mt-1 font-display text-2xl font-semibold tabular-nums">{counts[id]}</p>
                <p className="text-[11px] text-muted">{segmentDetail(id)}</p>
              </button>
            ))}
          </div>
        )
      ) : null}
      {show.has("fans-ltv") ? (
        <Panel
          title={`${segmentLabel(segment)} · ${fans.length} fans`}
          action={
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="soft" disabled={fans.length === 0} onClick={() => download(`segmento-${segment}.csv`, toCsv(["Creadora", "Fan", "Usuario", "Gasto total", "Suscrito", "Estado"], fans.map((fan) => [fan.creatorName, fan.name, fan.handle, csvMoney(fan.spentCents), fan.subscribedAt?.slice(0, 10) ?? null, fan.status === "active" ? "activo" : "caducado"])))}>Exportar CSV</Button>
              <Button type="button" variant="soft" disabled title="OnlyFans no tiene una ruta confirmada para crear listas; no se escribe nada en OnlyFans.">Crear lista en OnlyFans</Button>
            </div>
          }
        >
          <p className="mb-2 text-[11px] text-muted">«Crear lista en OnlyFans» queda desactivado: no hay ruta confirmada y no se escribe en OnlyFans. El segmento ya sirve como filtro en el chat y en los masivos.</p>
          {fans.length === 0 ? <Empty text={counts == null ? SIN_DATOS : "Ningún fan en este segmento"} /> : (
            <div className="max-h-[480px] overflow-auto">
              <table className="w-full text-sm" data-testid="segment-fans">
                <thead className="sticky top-0 bg-surface text-left text-xs text-muted">
                  <tr><th className="pb-2">Fan</th><th className="pb-2">Creadora</th><th className="pb-2 pr-6 text-right">Gasto total</th><th className="pb-2 pr-4">Suscrito</th><th className="pb-2">Estado</th><th /></tr>
                </thead>
                <tbody>
                  {fans.slice(0, 500).map((fan) => (
                    <tr key={`${fan.creatorId}:${fan.fanKey}`} className="border-t border-line">
                      <td className="py-1.5">{fan.name}{fan.handle ? <span className="ml-1 text-xs text-muted">@{fan.handle.replace(/^@/, "")}</span> : null}</td>
                      <td className="py-1.5">{fan.creatorName}</td>
                      <td className="py-1.5 pr-6 text-right tabular-nums">{formatValue("money", fan.spentCents)}</td>
                      <td className="py-1.5 pr-4 tabular-nums">{fan.subscribedAt?.slice(0, 10) ?? SIN_DATOS}</td>
                      <td className="py-1.5">{fan.status === "active" ? "Activo" : "Caducado"}</td>
                      <td className="py-1.5 text-right"><Button type="button" variant="ghost" className="px-2 py-1 text-xs" onClick={() => openChat(fan.creatorId, fan.fanKey)}>Ir al chat</Button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      ) : null}
    </div>
  );
}

export function ScreenTitle({ title, blurb, children }: { title: string; blurb: string; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-2">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="text-sm text-muted">{blurb}</p>
      </div>
      {children}
    </div>
  );
}
