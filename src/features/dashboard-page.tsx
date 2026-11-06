import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button, Panel, Select } from "@/components/ui";
import { useCrm } from "@/lib/crm";
import {
  alertLabelsFor,
  audienceOf,
  buildSummary,
  cardOf,
  isCardId,
  moveWidget,
  normalizeDashboardConfig,
  parseScreen,
  PERIODS,
  screenBlurb,
  screenLabel,
  SCREEN_IDS,
  screensFor,
  scopedCreators,
  selectionValue,
  setWidgetRoles,
  setWidgetVisible,
  visibleCreators,
  widgetDef,
  widgetsFor,
  type DashboardAudience,
  type ScreenId,
  type SummaryAlert,
  type SummaryFigures,
  type WidgetPlacement,
  SIN_DATOS,
} from "@/lib/dashboard-config";
import type { MetricPeriod } from "@/lib/creator-metrics";
import { formatCents } from "@/lib/format";
import { listCreatorSessions, listDashboard } from "@/lib/of-sessions";
import { useOfReads } from "@/lib/use-of-reads";

export function DashboardPage() {
  const creators = useCrm((s) => s.creators);
  const creatorId = useCrm((s) => s.creatorId);
  const setCreator = useCrm((s) => s.setCreator);
  const teamAccess = useCrm((s) => s.teamAccess);
  const dashboardConfig = useCrm((s) => s.dashboardConfig);
  const setDashboardConfig = useCrm((s) => s.setDashboardConfig);
  const reads = useOfReads();
  const [period, setPeriod] = useState<MetricPeriod>("month");
  const [screen, setScreen] = useState<ScreenId>("resumen");
  const [alerts, setAlerts] = useState<SummaryAlert[] | null>(null);
  const [sessions, setSessions] = useState<Array<{ creatorId: string; label: string }>>([]);

  useEffect(() => {
    setScreen(parseScreen(window.location.hash));
    const onHash = () => setScreen(parseScreen(window.location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    let stop = false;
    async function pull() {
      try {
        const [dash, rows] = await Promise.all([listDashboard(), listCreatorSessions()]);
        if (stop) return;
        setAlerts(dash.alerts);
        setSessions(rows.map((row) => ({ creatorId: row.creatorId, label: row.label })));
      } catch {
        if (!stop) setAlerts(null);
      }
    }
    void pull();
    const timer = setInterval(() => void pull(), 15_000);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, []);

  if (!teamAccess) return null;

  const config = normalizeDashboardConfig(dashboardConfig);
  const audience = audienceOf(teamAccess.role);
  const allowed = screensFor(teamAccess);
  const current = allowed.includes(screen) ? screen : "resumen";
  const visible = visibleCreators(teamAccess, creators);
  const selected = selectionValue(visible.map((creator) => creator.id), creatorId);
  const scoped = scopedCreators(teamAccess, creators, creatorId);
  const figures = buildSummary({
    role: teamAccess.role,
    period,
    now: new Date(),
    alerts,
    alertLabels: alertLabelsFor(scoped, sessions),
    reads: scoped.map((creator) => {
      const read = reads.byCreator.get(creator.id);
      return {
        creatorId: creator.id,
        earningsSyncedAt: read?.earningsSyncedAt ?? null,
        fansSyncedAt: read?.fansSyncedAt ?? null,
        earnings: read?.earnings ?? null,
        transactions: read?.transactions ?? null,
        fans: (read?.fans ?? []).map((fan) => ({
          status: fan.status,
          subscribedAt: fan.subscribedAt,
          renewAuto: fan.renewAuto,
        })),
      };
    }),
  });

  function open(next: ScreenId) {
    window.location.hash = next;
    setScreen(next);
  }

  return (
    <div className="flex min-h-full flex-col md:flex-row">
      <nav aria-label="Dashboard" className="flex gap-1 overflow-auto border-b border-line bg-surface p-2 md:w-52 md:shrink-0 md:flex-col md:border-r md:border-b-0 md:p-3">
        <p className="hidden px-2 pb-2 font-display text-sm font-semibold md:block">Dashboard</p>
        {allowed.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => open(id)}
            aria-current={current === id ? "page" : undefined}
            className={`rounded-md px-3 py-2 text-left text-sm ${current === id ? "bg-primary text-primary-fg" : "text-muted hover:bg-raised"}`}
          >
            {screenLabel(id)}
          </button>
        ))}
      </nav>
      <div className="min-w-0 flex-1">
        <header className="flex flex-wrap items-center gap-2 border-b border-line bg-surface px-4 py-3">
          <Select aria-label="Creadora" value={selected} onChange={(event) => setCreator(event.target.value)}>
            <option value="all">Todas</option>
            {visible.map((creator) => (
              <option key={creator.id} value={creator.id}>{creator.name}</option>
            ))}
          </Select>
          <Select aria-label="Rango" value={period} onChange={(event) => setPeriod(readPeriod(event.target.value))}>
            {PERIODS.map((item) => (
              <option key={item.id} value={item.id}>{item.label}</option>
            ))}
          </Select>
          <span className="text-xs text-muted">{teamAccess.role === "owner" ? "Dueña" : "Chatter"}</span>
        </header>
        <div className="space-y-4 p-4 md:p-6">
          {teamAccess.role !== "owner" && visible.length === 0 ? (
            <p className="text-sm text-muted">No tienes cuentas asignadas. La dueña las asigna en Equipo.</p>
          ) : null}
          {reads.error ? <p className="text-sm text-[#8a5a12]">{reads.error}</p> : null}
          {current === "resumen" ? (
            <Resumen audience={audience} config={config} figures={figures} />
          ) : current === "ajustes" ? (
            <ConfigEditor config={config} onChange={setDashboardConfig} />
          ) : (
            <Upcoming screen={current} config={config} audience={audience} />
          )}
        </div>
      </div>
    </div>
  );
}

function Resumen({
  audience,
  config,
  figures,
}: {
  audience: DashboardAudience;
  config: ReturnType<typeof normalizeDashboardConfig>;
  figures: SummaryFigures;
}) {
  const widgets = widgetsFor(config, "resumen", audience);
  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight">Resumen</h1>
        <p className="text-sm text-muted">{screenBlurb("resumen")}</p>
      </div>
      {widgets.length === 0 ? <p className="text-sm text-muted">{SIN_DATOS}</p> : null}
      {groupResumen(widgets).map((block) =>
        block.kind === "cards" ? (
          <div key={block.items.map((widget) => widget.id).join("-")} className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            {block.items.map((widget) => {
              if (!isCardId(widget.id)) return null;
              const figure = cardOf(figures, widget.id);
              const label = widgetDef(widget.id)?.label ?? widget.id;
              return (
                <article key={widget.id} className="rounded-lg border border-line bg-surface p-4">
                  <p className="text-xs text-muted">{label}</p>
                  <p className="mt-2 font-display text-2xl font-semibold tabular-nums">{figure.value}</p>
                  {figure.hint ? <p className="mt-1 text-xs text-muted">{figure.hint}</p> : null}
                </article>
              );
            })}
          </div>
        ) : (
          <ResumenExtra key={block.item.id} widget={block.item} figures={figures} />
        ),
      )}
    </div>
  );
}

function groupResumen(widgets: WidgetPlacement[]): Array<{ kind: "cards"; items: WidgetPlacement[] } | { kind: "widget"; item: WidgetPlacement }> {
  const blocks: Array<{ kind: "cards"; items: WidgetPlacement[] } | { kind: "widget"; item: WidgetPlacement }> = [];
  for (const widget of widgets) {
    if (!isCardId(widget.id)) {
      blocks.push({ kind: "widget", item: widget });
      continue;
    }
    const last = blocks.at(-1);
    if (last?.kind === "cards") last.items.push(widget);
    else blocks.push({ kind: "cards", items: [widget] });
  }
  return blocks;
}

function ResumenExtra({ widget, figures }: { widget: WidgetPlacement; figures: SummaryFigures }) {
  const label = widgetDef(widget.id)?.label ?? widget.id;
  switch (widget.id) {
    case "ingresos":
    case "suscripciones":
    case "ppv":
    case "tips":
    case "mensajes":
    case "fans-activos":
      return null;
    case "tendencia":
      return figures.tendencia == null ? (
        <Panel title={label}>
          <p className="text-sm text-muted">{SIN_DATOS}</p>
        </Panel>
      ) : (
        <Panel title={label} bodyClass="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={figures.tendencia}>
              <XAxis dataKey="label" tick={{ fill: "var(--color-muted)", fontSize: 12 }} axisLine={false} tickLine={false} />
              <YAxis hide />
              <Tooltip
                formatter={(value) => [formatCents(Number(value)), "Bruto"]}
                contentStyle={{ background: "var(--color-raised)", border: "1px solid var(--color-line)", color: "var(--color-fg)" }}
              />
              <Bar dataKey="grossCents" fill="var(--color-primary)" radius={6} />
            </BarChart>
          </ResponsiveContainer>
        </Panel>
      );
    case "alertas":
      return (
        <Panel title={label}>
          {figures.alertas == null ? (
            <p className="text-sm text-muted">{SIN_DATOS}</p>
          ) : figures.alertas.length === 0 ? (
            <p className="text-sm text-muted">Sin alertas</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {figures.alertas.map((alert) => (
                <li key={`${alert.kind}:${alert.text}`}>{alert.text}</li>
              ))}
            </ul>
          )}
        </Panel>
      );
    default:
      return null;
  }
}

function Upcoming({
  screen,
  config,
  audience,
}: {
  screen: ScreenId;
  config: ReturnType<typeof normalizeDashboardConfig>;
  audience: DashboardAudience;
}) {
  const widgets = widgetsFor(config, screen, audience);
  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight">{screenLabel(screen)}</h1>
        <p className="text-sm text-muted">{screenBlurb(screen)}</p>
      </div>
      <ExistingLink screen={screen} />
      {widgets.length === 0 ? (
        <p className="text-sm text-muted">{SIN_DATOS}</p>
      ) : (
        <ul className="space-y-2">
          {widgets.map((widget) => (
            <li key={widget.id} className="rounded-lg border border-line bg-surface px-4 py-3 text-sm">
              <span className="text-muted">{widgetDef(widget.id)?.label ?? widget.id}</span>
              <span className="mt-1 block font-medium">{SIN_DATOS}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ExistingLink({ screen }: { screen: ScreenId }) {
  switch (screen) {
    case "creadoras":
      return <Link to="/creadoras" className="text-sm font-medium text-primary">Abrir creadoras</Link>;
    case "fans":
      return <Link to="/analitica" className="text-sm font-medium text-primary">Abrir analítica</Link>;
    case "chatters":
      return <Link to="/equipo" className="text-sm font-medium text-primary">Abrir equipo</Link>;
    case "campanas":
      return <Link to="/campanas" className="text-sm font-medium text-primary">Abrir campañas</Link>;
    case "resumen":
    case "ajustes":
      return null;
    default: {
      const exhaustive: never = screen;
      return exhaustive;
    }
  }
}

function ConfigEditor({
  config,
  onChange,
}: {
  config: ReturnType<typeof normalizeDashboardConfig>;
  onChange: (config: ReturnType<typeof normalizeDashboardConfig>) => void;
}) {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight">Ajustes</h1>
        <p className="text-sm text-muted">{screenBlurb("ajustes")} Se guarda en la base compartida.</p>
      </div>
      {SCREEN_IDS.filter((screen) => screen !== "ajustes").map((screen) => {
        const widgets = config.widgets.filter((widget) => widgetDef(widget.id)?.screen === screen);
        return (
          <Panel key={screen} title={screenLabel(screen)}>
            <ul className="space-y-3">
              {widgets.map((widget, index) => {
                const def = widgetDef(widget.id);
                return (
                  <li key={widget.id} className="flex flex-wrap items-center gap-3 border-b border-line pb-3 last:border-0 last:pb-0">
                    <label className="flex min-w-40 items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-primary"
                        checked={widget.visible}
                        aria-label={`Ver ${def?.label ?? widget.id}`}
                        onChange={(event) => onChange(setWidgetVisible(config, widget.id, event.target.checked))}
                      />
                      {def?.label ?? widget.id}
                    </label>
                    {def?.revenue ? (
                      <span className="text-xs text-muted">Solo la dueña</span>
                    ) : (
                      <span className="flex gap-3 text-xs">
                        {(["owner", "chatter"] as const).map((role) => (
                          <label key={role} className="flex items-center gap-1">
                            <input
                              type="checkbox"
                              className="h-4 w-4 accent-primary"
                              checked={widget.roles.includes(role)}
                              aria-label={`${def?.label ?? widget.id} ${role === "owner" ? "Dueña" : "Chatter"}`}
                              onChange={(event) => {
                                const roles = event.target.checked
                                  ? [...widget.roles, role]
                                  : widget.roles.filter((item) => item !== role);
                                onChange(setWidgetRoles(config, widget.id, roles));
                              }}
                            />
                            {role === "owner" ? "Dueña" : "Chatter"}
                          </label>
                        ))}
                      </span>
                    )}
                    <span className="ml-auto flex gap-1">
                      <Button type="button" variant="ghost" disabled={index === 0} onClick={() => onChange(moveWidget(config, widget.id, -1))}>
                        Subir
                      </Button>
                      <Button type="button" variant="ghost" disabled={index === widgets.length - 1} onClick={() => onChange(moveWidget(config, widget.id, 1))}>
                        Bajar
                      </Button>
                    </span>
                  </li>
                );
              })}
            </ul>
          </Panel>
        );
      })}
    </div>
  );
}

function readPeriod(value: string): MetricPeriod {
  switch (value) {
    case "day":
    case "week":
    case "month":
      return value;
    default:
      return "month";
  }
}
