import { useEffect, useState } from "react";
import { canSeeAgencyEarnings, hasPerm } from "@/lib/access-policy";
import { ShiftBoard } from "@/features/shift-board";
import { Link, useNavigate } from "@tanstack/react-router";
import { NotificationBell } from "@/features/notification-bell";
import { Button, Panel } from "@/components/ui";
import { useCrm } from "@/lib/crm";
import {
  audienceOf,
  moveWidget,
  normalizeDashboardConfig,
  screenBlurb,
  screenLabel,
  SCREEN_IDS,
  screensFor,
  setWidgetRoles,
  setWidgetVisible,
  widgetDef,
  widgetsFor,
  type DashboardAudience,
  type ScreenId,
  SIN_DATOS,
} from "@/lib/dashboard-config";
import type { MetricPeriod } from "@/lib/creator-metrics";
import { AnalyticsPage, AuditPage } from "@/features/control-pages";
import { rememberOpenThread } from "@/lib/open-thread";
import {
  ChattersScreen,
  CreadorasScreen,
  defaultFilters,
  InsightsHeader,
  NuevosScreen,
  RendimientoScreen,
  ResumenScreen,
  ScreenTitle,
  SegmentosScreen,
  useDashboardInsights,
  type InsightFilters,
} from "@/features/dashboard-insights";
import {
  canOpenMessagePanel,
  canOpenReports,
  dashboardZone,
  navRoleFromAccess,
  reportBodyKind,
  reportHash,
  reportTabsFor,
  type DashboardZone,
  type ReportView,
} from "@/lib/nav-config";

export function DashboardPage() {
  const teamAccess = useCrm((s) => s.teamAccess);
  const dashboardConfig = useCrm((s) => s.dashboardConfig);
  const setDashboardConfig = useCrm((s) => s.setDashboardConfig);
  const setCreator = useCrm((s) => s.setCreator);
  const navigate = useNavigate();
  const [period, setPeriod] = useState<MetricPeriod>("month");
  const [zone, setZone] = useState<DashboardZone>(() => dashboardZone(window.location.hash));
  const [filters, setFilters] = useState<InsightFilters>(() => defaultFilters());
  const insights = useDashboardInsights(filters, Boolean(teamAccess));

  useEffect(() => {
    const onHash = () => setZone(dashboardZone(window.location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  if (!teamAccess) return null;

  const config = normalizeDashboardConfig(dashboardConfig);
  // Admin y Supervisor (permiso «estadisticas») ven la vista de agencia, como la dueña.
  const audience = audienceOf(teamAccess);
  const agency = canSeeAgencyEarnings(teamAccess);
  const allowed = screensFor(teamAccess);
  const navRole = navRoleFromAccess(teamAccess);
  const reportsOk = canOpenReports(navRole, teamAccess);
  const panelOk = canOpenMessagePanel(navRole, teamAccess);
  const showingReports = zone.kind === "informes";
  const current = zone.kind === "metricas" && allowed.includes(zone.screen) ? zone.screen : "resumen";
  const view = insights.view;
  const selected = filters.creatorId;

  function open(next: ScreenId) {
    window.location.hash = next;
    setZone({ kind: "metricas", screen: next });
  }

  function openReport(next: ReportView) {
    window.location.hash = reportHash(next);
    setZone({ kind: "informes", vista: next });
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
            aria-current={!showingReports && current === id ? "page" : undefined}
            className={`rounded-md px-3 py-2 text-left text-sm ${!showingReports && current === id ? "bg-primary text-primary-fg" : "text-muted hover:bg-raised"}`}
          >
            {screenLabel(id)}
          </button>
        ))}
        {reportsOk ? (
          <button
            type="button"
            onClick={() => openReport(zone.kind === "informes" ? zone.vista : "creadoras")}
            aria-current={showingReports ? "page" : undefined}
            className={`rounded-md px-3 py-2 text-left text-sm ${showingReports ? "bg-primary text-primary-fg" : "text-muted hover:bg-raised"}`}
          >
            Informes
          </button>
        ) : null}
      </nav>
      <div className="min-w-0 flex-1">
        <div className="relative">
          <InsightsHeader name={teamAccess.displayName} filters={filters} onChange={setFilters} view={view} loading={insights.loading} agency={agency} />
          {selected !== "all" ? (
            <div className="absolute top-3 right-4">
              <NotificationBell
                creatorId={selected}
                creatorName={view?.creators.find((creator) => creator.id === selected)?.name ?? null}
                onOpenThread={(target) => {
                  setCreator(target.creatorId);
                  rememberOpenThread(target);
                  void navigate({ to: "/mensajes" });
                }}
              />
            </div>
          ) : null}
        </div>
        <div className="space-y-4 p-4 md:p-6" data-testid="dashboard-body" data-audience={audience}>
          {!agency && teamAccess.creatorIds.length === 0 && !teamAccess.perms.includes("todas") ? (
            <p className="text-sm text-muted">No tienes cuentas asignadas. La dueña las asigna en Personal.</p>
          ) : null}
          {teamAccess && !hasPerm(teamAccess, "equipo") && current === "resumen" ? <ShiftBoard compact /> : null}
          {insights.error ? <p className="text-sm text-[#8a5a12]">{insights.error}</p> : null}
          {showingReports ? (
            <ReportsPanel
              vista={zone.vista}
              allowed={reportsOk}
              panelOk={panelOk}
              period={period}
              onPeriod={setPeriod}
              onView={openReport}
            />
          ) : current === "ajustes" ? (
            <ConfigEditor config={config} onChange={setDashboardConfig} />
          ) : current === "campanas" ? (
            <Upcoming screen={current} config={config} audience={audience} />
          ) : (
            <>
              <ScreenTitle title={screenLabel(current)} blurb={screenBlurb(current)} />
              {!view ? (
                <p className="text-sm text-muted">{insights.loading ? "Cargando…" : SIN_DATOS}</p>
              ) : current === "resumen" ? (
                <ResumenScreen view={view} config={config} audience={audience} filters={filters} onFilters={setFilters} />
              ) : current === "creadoras" ? (
                <CreadorasScreen view={view} config={config} audience={audience} />
              ) : current === "rendimiento" ? (
                <RendimientoScreen view={view} filters={filters} />
              ) : current === "chatters" ? (
                <ChattersScreen view={view} config={config} audience={audience} />
              ) : current === "nuevos" ? (
                <NuevosScreen view={view} config={config} audience={audience} />
              ) : (
                <SegmentosScreen view={view} config={config} audience={audience} />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ReportsPanel({
  vista,
  allowed,
  panelOk,
  period,
  onPeriod,
  onView,
}: {
  vista: ReportView;
  allowed: boolean;
  panelOk: boolean;
  period: MetricPeriod;
  onPeriod: (period: MetricPeriod) => void;
  onView: (vista: ReportView) => void;
}) {
  const tabs = reportTabsFor(panelOk);
  if (!allowed) {
    return <p className="text-sm text-muted">No tienes acceso a los informes.</p>;
  }
  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight">Informes</h1>
        <p className="text-sm text-muted">Analítica de creadoras, equipo y fans. Los totales de la agencia los ve la dueña.</p>
      </div>
      <div className="flex flex-wrap gap-1 rounded-md border border-line p-1">
        {tabs.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => onView(item)}
            className={`rounded-md px-3 py-1 text-sm ${vista === item ? "bg-raised text-fg" : "text-muted"}`}
          >
            {reportTabLabel(item)}
          </button>
        ))}
      </div>
      <ReportBody vista={vista} panelOk={panelOk} period={period} onPeriod={onPeriod} />
    </div>
  );
}

function ReportBody({ vista, panelOk, period, onPeriod }: { vista: ReportView; panelOk: boolean; period: MetricPeriod; onPeriod: (period: MetricPeriod) => void }) {
  const kind = reportBodyKind(vista, panelOk);
  switch (kind) {
    case "analytics":
      return <AnalyticsPage key={vista} initialView={vista === "mensajes" ? "creadoras" : vista} embedded period={period} onPeriod={onPeriod} />;
    case "audit":
      return <AuditPage />;
    case "denied":
      return <p className="text-sm text-muted">El panel de mensajes lo ve la dueña.</p>;
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

function reportTabLabel(vista: ReportView): string {
  switch (vista) {
    case "creadoras":
      return "Creadoras";
    case "equipo":
      return "Equipo";
    case "fans":
      return "Fans";
    case "mensajes":
      return "Panel de mensajes";
    default: {
      const exhaustive: never = vista;
      return exhaustive;
    }
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
      return <Link to="/administrar" search={{ tab: "creadoras" }} className="text-sm font-medium text-primary">Abrir creadoras</Link>;
    case "segmentos":
      return <a href="/#informes-fans" className="text-sm font-medium text-primary">Ver informes de fans</a>;
    case "rendimiento":
    case "nuevos":
      return null;
    case "chatters":
      return <Link to="/administrar" search={{ tab: "empleados" }} className="text-sm font-medium text-primary">Abrir empleados</Link>;
    case "campanas":
      return <Link to="/funciones" search={{ tab: "masivos" }} className="text-sm font-medium text-primary">Abrir campañas</Link>;
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

