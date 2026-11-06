import {
  changeRatio,
  creatorReport,
  syncedKindGross,
  type MetricEarning,
  type MetricFan,
  type MetricPeriod,
  type MetricTx,
} from "./creator-metrics.ts";
import { formatCents, pct } from "./format.ts";

export const SIN_DATOS = "Sin datos";

export const SCREEN_IDS = ["resumen", "creadoras", "fans", "chatters", "campanas", "ajustes"] as const;
export type ScreenId = (typeof SCREEN_IDS)[number];

export const DASHBOARD_ROLES = ["owner", "chatter"] as const;
export type DashboardAudience = (typeof DASHBOARD_ROLES)[number];

export const PERIODS: Array<{ id: MetricPeriod; label: string }> = [
  { id: "day", label: "Hoy" },
  { id: "week", label: "7 días" },
  { id: "month", label: "Mes" },
];

export type WidgetDef = {
  id: string;
  screen: ScreenId;
  label: string;
  revenue: boolean;
  defaultVisible: boolean;
  defaultOrder: number;
  defaultRoles: DashboardAudience[];
};

export type WidgetPlacement = {
  id: string;
  visible: boolean;
  order: number;
  roles: DashboardAudience[];
};

export type DashboardConfig = {
  version: 1;
  widgets: WidgetPlacement[];
};

export const WIDGETS: WidgetDef[] = [
  { id: "ingresos", screen: "resumen", label: "Ingresos", revenue: true, defaultVisible: true, defaultOrder: 10, defaultRoles: ["owner"] },
  { id: "suscripciones", screen: "resumen", label: "Suscripciones", revenue: true, defaultVisible: true, defaultOrder: 20, defaultRoles: ["owner"] },
  { id: "ppv", screen: "resumen", label: "PPV", revenue: true, defaultVisible: true, defaultOrder: 30, defaultRoles: ["owner"] },
  { id: "tips", screen: "resumen", label: "Tips", revenue: true, defaultVisible: true, defaultOrder: 40, defaultRoles: ["owner"] },
  { id: "mensajes", screen: "resumen", label: "Mensajes", revenue: false, defaultVisible: true, defaultOrder: 50, defaultRoles: ["owner", "chatter"] },
  { id: "fans-activos", screen: "resumen", label: "Fans activos", revenue: false, defaultVisible: true, defaultOrder: 60, defaultRoles: ["owner", "chatter"] },
  { id: "tendencia", screen: "resumen", label: "Tendencia", revenue: true, defaultVisible: true, defaultOrder: 70, defaultRoles: ["owner"] },
  { id: "alertas", screen: "resumen", label: "Alertas", revenue: false, defaultVisible: true, defaultOrder: 80, defaultRoles: ["owner", "chatter"] },
  { id: "creadoras-cuentas", screen: "creadoras", label: "Cuentas", revenue: false, defaultVisible: true, defaultOrder: 10, defaultRoles: ["owner", "chatter"] },
  { id: "creadoras-ingresos", screen: "creadoras", label: "Ingresos por creadora", revenue: true, defaultVisible: true, defaultOrder: 20, defaultRoles: ["owner"] },
  { id: "fans-segmentos", screen: "fans", label: "Segmentos", revenue: false, defaultVisible: true, defaultOrder: 10, defaultRoles: ["owner", "chatter"] },
  { id: "fans-ltv", screen: "fans", label: "Gasto del fan", revenue: false, defaultVisible: true, defaultOrder: 20, defaultRoles: ["owner", "chatter"] },
  { id: "chatters-ventas", screen: "chatters", label: "Ventas atribuidas", revenue: false, defaultVisible: true, defaultOrder: 10, defaultRoles: ["owner", "chatter"] },
  { id: "chatters-respuesta", screen: "chatters", label: "Tiempo de respuesta", revenue: false, defaultVisible: true, defaultOrder: 20, defaultRoles: ["owner", "chatter"] },
  { id: "campanas-estado", screen: "campanas", label: "Estado", revenue: false, defaultVisible: true, defaultOrder: 10, defaultRoles: ["owner", "chatter"] },
  { id: "campanas-resultado", screen: "campanas", label: "Resultado", revenue: true, defaultVisible: true, defaultOrder: 20, defaultRoles: ["owner"] },
];

const WIDGET_BY_ID = new Map(WIDGETS.map((widget) => [widget.id, widget]));

export type CardId = "ingresos" | "suscripciones" | "ppv" | "tips" | "mensajes" | "fans-activos";

export type Figure = { value: string; hint: string };

export type SummaryRead = {
  creatorId: string;
  earningsSyncedAt: string | null;
  fansSyncedAt: string | null;
  earnings: MetricEarning[] | null;
  transactions: MetricTx[] | null;
  fans: MetricFan[];
};

export type SummaryAlert = { kind: string; text: string };

export type SummarySeriesPoint = { label: string; grossCents: number };

export type SummaryFigures = {
  cards: Record<CardId, Figure>;
  tendencia: SummarySeriesPoint[] | null;
  alertas: SummaryAlert[] | null;
};

export type DashboardAccess = {
  role: "owner" | "member";
  perms: string[];
  creatorIds: string[];
};

export function isScreenId(value: string): value is ScreenId {
  return (SCREEN_IDS as readonly string[]).includes(value);
}

export function parseScreen(value: string): ScreenId {
  const id = value.replace(/^#/, "").trim();
  return isScreenId(id) ? id : "resumen";
}

export function screenLabel(screen: ScreenId): string {
  switch (screen) {
    case "resumen":
      return "Resumen";
    case "creadoras":
      return "Creadoras";
    case "fans":
      return "Fans";
    case "chatters":
      return "Chatters";
    case "campanas":
      return "Campañas";
    case "ajustes":
      return "Ajustes";
    default: {
      const exhaustive: never = screen;
      return exhaustive;
    }
  }
}

export function screenBlurb(screen: ScreenId): string {
  switch (screen) {
    case "resumen":
      return "Cifras del rango elegido, solo con lo ya sincronizado.";
    case "creadoras":
      return "Cuentas visibles para este rol. El detalle operativo sigue en Creadoras.";
    case "fans":
      return "Segmentos de fanProfiles. Esta fase aún no pinta la lista.";
    case "chatters":
      return "Atribución y respuesta de chatterReports. Esta fase aún no pinta la tabla.";
    case "campanas":
      return "Estado de las campañas guardadas. Esta fase aún no pinta el resultado.";
    case "ajustes":
      return "Qué widgets se ven, en qué orden y para qué rol.";
    default: {
      const exhaustive: never = screen;
      return exhaustive;
    }
  }
}

export function audienceOf(role: "owner" | "member"): DashboardAudience {
  return role === "owner" ? "owner" : "chatter";
}

export function screensFor(access: { role: "owner" | "member"; perms: string[] } | null): ScreenId[] {
  if (!access) return [];
  if (access.role === "owner") return [...SCREEN_IDS];
  const screens: ScreenId[] = ["resumen", "creadoras", "fans", "chatters"];
  if (access.perms.includes("campanas")) screens.push("campanas");
  return screens;
}

export function widgetDef(id: string): WidgetDef | null {
  return WIDGET_BY_ID.get(id) ?? null;
}

export function defaultDashboardConfig(): DashboardConfig {
  return normalizeDashboardConfig({ version: 1, widgets: [] });
}

export function normalizeDashboardConfig(raw: unknown): DashboardConfig {
  const incoming = new Map<string, WidgetPlacement>();
  const record = asRecord(raw);
  const list = record && Array.isArray(record.widgets) ? record.widgets : [];
  for (const item of list) {
    const row = asRecord(item);
    if (!row || typeof row.id !== "string") continue;
    const def = WIDGET_BY_ID.get(row.id);
    if (!def) continue;
    incoming.set(def.id, {
      id: def.id,
      visible: row.visible !== false,
      order: typeof row.order === "number" && Number.isFinite(row.order) ? row.order : def.defaultOrder,
      roles: readRoles(row.roles, def),
    });
  }
  const widgets = WIDGETS.map((def) => incoming.get(def.id) ?? defaultPlacement(def));
  return { version: 1, widgets: denseOrders(widgets) };
}

export function sameDashboardConfig(left: unknown, right: unknown): boolean {
  return JSON.stringify(normalizeDashboardConfig(left)) === JSON.stringify(normalizeDashboardConfig(right));
}

export function widgetsFor(config: unknown, screen: ScreenId, audience: DashboardAudience): WidgetPlacement[] {
  return normalizeDashboardConfig(config).widgets.filter((widget) => {
    const def = WIDGET_BY_ID.get(widget.id);
    if (!def || def.screen !== screen || !widget.visible) return false;
    if (def.revenue && audience !== "owner") return false;
    return widget.roles.includes(audience);
  });
}

export function setWidgetVisible(config: unknown, id: string, visible: boolean): DashboardConfig {
  const next = normalizeDashboardConfig(config);
  return normalizeDashboardConfig({
    version: 1,
    widgets: next.widgets.map((widget) => (widget.id === id ? { ...widget, visible } : widget)),
  });
}

export function setWidgetRoles(config: unknown, id: string, roles: DashboardAudience[]): DashboardConfig {
  const next = normalizeDashboardConfig(config);
  return normalizeDashboardConfig({
    version: 1,
    widgets: next.widgets.map((widget) => (widget.id === id ? { ...widget, roles } : widget)),
  });
}

export function moveWidget(config: unknown, id: string, direction: -1 | 1): DashboardConfig {
  const next = normalizeDashboardConfig(config);
  const def = WIDGET_BY_ID.get(id);
  if (!def) return next;
  const siblings = next.widgets.filter((widget) => WIDGET_BY_ID.get(widget.id)?.screen === def.screen);
  const index = siblings.findIndex((widget) => widget.id === id);
  const current = siblings[index];
  const swap = siblings[index + direction];
  if (!current || !swap) return next;
  return normalizeDashboardConfig({
    version: 1,
    widgets: next.widgets.map((widget) => {
      if (widget.id === current.id) return { ...widget, order: swap.order };
      if (widget.id === swap.id) return { ...widget, order: current.order };
      return widget;
    }),
  });
}

export function visibleCreators<T extends { id: string }>(
  access: { role: "owner" | "member"; creatorIds: string[] } | null,
  creators: T[],
): T[] {
  if (!access) return [];
  if (access.role === "owner") return creators;
  const allowed = new Set(access.creatorIds);
  return creators.filter((creator) => allowed.has(creator.id));
}

export function scopedCreators<T extends { id: string }>(
  access: { role: "owner" | "member"; creatorIds: string[] } | null,
  creators: T[],
  selectedId: string,
): T[] {
  const visible = visibleCreators(access, creators);
  if (selectedId === "all" || !visible.some((creator) => creator.id === selectedId)) return visible;
  return visible.filter((creator) => creator.id === selectedId);
}

export function selectionValue(visibleIds: string[], selectedId: string): string {
  if (selectedId !== "all" && visibleIds.includes(selectedId)) return selectedId;
  return "all";
}

export function alertLabelsFor(
  creators: Array<{ id: string; name: string }>,
  sessions: Array<{ creatorId: string; label: string }>,
): string[] {
  const ids = new Set(creators.map((creator) => creator.id));
  const labels = new Set<string>();
  for (const creator of creators) {
    if (creator.name.trim()) labels.add(creator.name);
  }
  for (const session of sessions) {
    if (ids.has(session.creatorId) && session.label.trim()) labels.add(session.label);
  }
  return [...labels];
}

export function alertsInScope<T extends { text: string }>(alerts: T[] | null, labels: string[]): T[] | null {
  if (alerts == null) return null;
  const prefixes = labels.filter((label) => label.trim()).map((label) => `${label}:`);
  if (prefixes.length === 0) return [];
  return alerts.filter((alert) => prefixes.some((prefix) => alert.text.startsWith(prefix)));
}

export function buildSummary(input: {
  role: "owner" | "member";
  period: MetricPeriod;
  now: Date;
  reads: SummaryRead[];
  alerts: SummaryAlert[] | null;
  alertLabels: string[];
}): SummaryFigures {
  const owner = input.role === "owner";
  const transactions = owner ? input.reads.flatMap((read) => read.transactions ?? []) : [];
  const earnings = owner ? input.reads.flatMap((read) => read.earnings ?? []) : [];
  const earningsSynced = owner && input.reads.some((read) => Boolean(read.earningsSyncedAt));
  const syncedFans = input.reads.filter((read) => read.fansSyncedAt);
  const fansSynced = syncedFans.length > 0;
  const report = creatorReport({
    now: input.now,
    period: input.period,
    transactions,
    earnings,
    fans: syncedFans.flatMap((read) => read.fans),
    earningsSynced,
    fansSynced,
  });
  const kind = (name: string) =>
    owner
      ? syncedKindGross({
          now: input.now,
          period: input.period,
          kind: name,
          transactions,
          earnings,
          earningsSynced,
        })
      : null;
  const ratio = owner ? changeRatio(report.grossCents, report.previousGrossCents) : null;
  return {
    cards: {
      ingresos: moneyFigure(owner ? report.grossCents : null, ratio == null ? "" : `Variación ${pct(ratio)}`),
      suscripciones: moneyFigure(kind("subscription"), ""),
      ppv: moneyFigure(kind("message"), ""),
      tips: moneyFigure(kind("tip"), ""),
      mensajes: { value: SIN_DATOS, hint: "" },
      "fans-activos": {
        value: report.activeFans == null ? SIN_DATOS : String(report.activeFans),
        hint: "",
      },
    },
    tendencia: owner && report.series.length > 0 ? report.series.map((point) => ({ label: point.label, grossCents: point.grossCents })) : null,
    alertas: alertsInScope(input.alerts, input.alertLabels),
  };
}

export function cardOf(figures: SummaryFigures, id: CardId): Figure {
  switch (id) {
    case "ingresos":
    case "suscripciones":
    case "ppv":
    case "tips":
    case "mensajes":
    case "fans-activos":
      return figures.cards[id];
    default: {
      const exhaustive: never = id;
      return exhaustive;
    }
  }
}

export function isCardId(id: string): id is CardId {
  switch (id) {
    case "ingresos":
    case "suscripciones":
    case "ppv":
    case "tips":
    case "mensajes":
    case "fans-activos":
      return true;
    default:
      return false;
  }
}

function moneyFigure(cents: number | null, hint: string): Figure {
  if (cents == null) return { value: SIN_DATOS, hint: "" };
  return { value: formatCents(cents), hint };
}

function defaultPlacement(def: WidgetDef): WidgetPlacement {
  return {
    id: def.id,
    visible: def.defaultVisible,
    order: def.defaultOrder,
    roles: readRoles(def.defaultRoles, def),
  };
}

function readRoles(value: unknown, def: WidgetDef): DashboardAudience[] {
  if (def.revenue) return ["owner"];
  const picked = Array.isArray(value) ? DASHBOARD_ROLES.filter((role) => value.includes(role)) : [];
  if (picked.length > 0) return [...picked];
  return [...def.defaultRoles];
}

function denseOrders(widgets: WidgetPlacement[]): WidgetPlacement[] {
  const next: WidgetPlacement[] = [];
  for (const screen of SCREEN_IDS) {
    const list = widgets
      .filter((widget) => WIDGET_BY_ID.get(widget.id)?.screen === screen)
      .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
    list.forEach((widget, index) => next.push({ ...widget, order: (index + 1) * 10 }));
  }
  return next;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}
