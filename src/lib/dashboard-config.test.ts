import assert from "node:assert/strict";
import { test } from "node:test";
import { assertWorkspaceChange, emptyWorkspace, WorkspaceAccessError, type TeamAccess } from "./access-policy.ts";
import { pct } from "./format.ts";
import {
  alertsInScope,
  dashboardCreatorIds,
  buildSummary,
  defaultDashboardConfig,
  moveWidget,
  normalizeDashboardConfig,
  parseScreen,
  sameDashboardConfig,
  scopedCreators,
  screensFor,
  selectionValue,
  setWidgetRoles,
  setWidgetVisible,
  visibleCreators,
  widgetsFor,
  SIN_DATOS,
} from "./dashboard-config.ts";

const NOW = new Date("2026-11-05T18:00:00.000Z");

const owner: TeamAccess = { userId: "owner", role: "owner", perms: [], creatorIds: [] };
const chatter: TeamAccess = { userId: "chatter", role: "member", perms: ["mensajes"], creatorIds: ["c-alba"] };

test("el menú de la dueña incluye ajustes y el del chatter no", () => {
  assert.deepEqual(screensFor({ role: "owner", perms: [] }), ["resumen", "creadoras", "fans", "chatters", "campanas", "ajustes"]);
  assert.deepEqual(screensFor({ role: "member", perms: ["mensajes"] }), ["resumen", "creadoras", "fans", "chatters"]);
  assert.equal(screensFor({ role: "member", perms: ["campanas"] }).includes("campanas"), true);
  assert.equal(parseScreen("#fans"), "fans");
  assert.equal(parseScreen("#desconocida"), "resumen");
});

test("un chatter no ve importes aunque la configuración se los asigne", () => {
  const forced = setWidgetRoles(defaultDashboardConfig(), "ingresos", ["owner", "chatter"]);
  const ids = widgetsFor(forced, "resumen", "chatter").map((widget) => widget.id);
  assert.equal(ids.includes("ingresos"), false);
  assert.equal(ids.includes("ppv"), false);
  assert.equal(ids.includes("tips"), false);
  assert.equal(ids.includes("suscripciones"), false);
  assert.equal(ids.includes("tendencia"), false);
  assert.equal(ids.includes("fans-activos"), true);
  assert.deepEqual(widgetsFor(forced, "resumen", "owner").map((widget) => widget.id).slice(0, 4), [
    "ingresos",
    "suscripciones",
    "ppv",
    "tips",
  ]);
});

test("la dueña oculta y reordena un widget", () => {
  const hidden = setWidgetVisible(defaultDashboardConfig(), "tips", false);
  assert.equal(widgetsFor(hidden, "resumen", "owner").some((widget) => widget.id === "tips"), false);
  const moved = moveWidget(defaultDashboardConfig(), "tips", -1);
  const order = widgetsFor(moved, "resumen", "owner").map((widget) => widget.id);
  assert.equal(order.indexOf("tips") < order.indexOf("ppv"), true);
  assert.equal(moveWidget(defaultDashboardConfig(), "ingresos", -1).widgets[0]?.id, "ingresos");
});

test("una configuración vieja o rota vuelve al defecto", () => {
  const normalized = normalizeDashboardConfig({
    version: 1,
    widgets: [
      { id: "inventado", visible: true, order: 1, roles: ["chatter"] },
      { id: "ppv", visible: false, order: 1, roles: ["chatter"] },
    ],
  });
  assert.equal(normalized.widgets.some((widget) => widget.id === "inventado"), false);
  const ppv = normalized.widgets.find((widget) => widget.id === "ppv");
  assert.equal(ppv?.visible, false);
  assert.deepEqual(ppv?.roles, ["owner"]);
  assert.equal(sameDashboardConfig(undefined, defaultDashboardConfig()), true);
  assert.equal(normalized.widgets.filter((widget) => widget.id === "alertas").length, 1);
});

test("el chatter solo entra en sus cuentas", () => {
  const creators = [
    { id: "c-alba", name: "Alba" },
    { id: "c-nora", name: "Nora" },
  ];
  assert.deepEqual(visibleCreators(chatter, creators).map((creator) => creator.id), ["c-alba"]);
  assert.deepEqual(scopedCreators(chatter, creators, "c-nora").map((creator) => creator.id), ["c-alba"]);
  assert.deepEqual(scopedCreators(owner, creators, "c-nora").map((creator) => creator.id), ["c-nora"]);
  assert.equal(selectionValue(["c-alba"], "c-nora"), "all");
  assert.deepEqual(visibleCreators(null, creators), []);
});

test("el servidor del dashboard recorta las cuentas del chatter", () => {
  const accounts = [{ creatorId: "c-alba" }, { creatorId: "c-nora" }, { creatorId: null }];
  assert.deepEqual(dashboardCreatorIds(chatter, accounts), ["c-alba"]);
  assert.deepEqual(dashboardCreatorIds(owner, accounts), ["c-alba", "c-nora"]);
  assert.deepEqual(dashboardCreatorIds(null, accounts), []);
});

test("las alertas se quedan en las cuentas visibles", () => {
  const alerts = [
    { kind: "session", text: "Alba: sesión caducada. Pulsa Reconectar." },
    { kind: "sync", text: "Nora: sincronización fallida. Sin detalle" },
  ];
  const scoped = alertsInScope(alerts, ["Alba"]);
  assert.ok(scoped);
  assert.equal(scoped.length, 1);
  assert.deepEqual(alertsInScope(null, ["Alba"]), null);
  assert.deepEqual(alertsInScope(alerts, []), []);
});

test("el resumen usa el bruto sincronizado y no inventa el resto", () => {
  const figures = buildSummary({
    role: "owner",
    period: "month",
    now: NOW,
    alertLabels: ["Alba"],
    alerts: [{ kind: "session", text: "Alba: sesión caducada. Pulsa Reconectar." }],
    reads: [
      {
        creatorId: "c-alba",
        earningsSyncedAt: "2026-11-05T12:00:00.000Z",
        fansSyncedAt: "2026-11-05T12:00:00.000Z",
        earnings: [],
        transactions: [
          { occurredAt: "2026-11-03T15:00:00.000Z", grossCents: 1000, netCents: 800, kind: "tip" },
          { occurredAt: "2026-11-04T15:00:00.000Z", grossCents: 400, netCents: 400, kind: "message" },
          { occurredAt: "2026-10-20T15:00:00.000Z", grossCents: 500, netCents: null, kind: "subscription" },
        ],
        fans: [
          { status: "active", subscribedAt: "2026-11-02T00:00:00.000Z", renewAuto: true },
          { status: "expired", subscribedAt: "2026-01-01T00:00:00.000Z", renewAuto: null },
        ],
      },
    ],
  });
  assert.equal(figures.cards.ingresos.value, "$14.00");
  assert.equal(figures.cards.ingresos.hint, `Variación ${pct(1.8)}`);
  assert.equal(figures.cards.tips.value, "$10.00");
  assert.equal(figures.cards.ppv.value, "$4.00");
  assert.equal(figures.cards.suscripciones.value, SIN_DATOS);
  assert.equal(figures.cards.mensajes.value, SIN_DATOS);
  assert.equal(figures.cards["fans-activos"].value, "1");
  assert.equal(figures.tendencia?.length, 5);
  assert.equal(figures.alertas?.length, 1);
});

test("sin sincronizar y sin ser dueña no hay importes", () => {
  const empty = buildSummary({
    role: "owner",
    period: "day",
    now: NOW,
    reads: [],
    alerts: null,
    alertLabels: [],
  });
  assert.equal(empty.cards.ingresos.value, SIN_DATOS);
  assert.equal(empty.cards["fans-activos"].value, SIN_DATOS);
  assert.equal(empty.tendencia, null);
  assert.equal(empty.alertas, null);

  const member = buildSummary({
    role: "member",
    period: "month",
    now: NOW,
    alertLabels: ["Alba"],
    alerts: [],
    reads: [
      {
        creatorId: "c-alba",
        earningsSyncedAt: "2026-11-05T12:00:00.000Z",
        fansSyncedAt: "2026-11-05T12:00:00.000Z",
        earnings: [{ day: "2026-11-05", kind: "tip", amountCents: 900 }],
        transactions: [{ occurredAt: "2026-11-05T10:00:00.000Z", grossCents: 900, netCents: 900, kind: "tip" }],
        fans: [{ status: "active", subscribedAt: null, renewAuto: null }],
      },
    ],
  });
  assert.equal(member.cards.ingresos.value, SIN_DATOS);
  assert.equal(member.cards.tips.value, SIN_DATOS);
  assert.equal(member.tendencia, null);
  assert.equal(member.cards["fans-activos"].value, "1");
  assert.deepEqual(member.alertas, []);
});

test("el PPV sale de la fila de mensajes cuando no hay transacciones", () => {
  const figures = buildSummary({
    role: "owner",
    period: "day",
    now: NOW,
    reads: [
      {
        creatorId: "c-alba",
        earningsSyncedAt: "2026-11-05T12:00:00.000Z",
        fansSyncedAt: null,
        earnings: [
          { day: "2026-11-05", kind: "message", amountCents: 250 },
          { day: "2026-11-04", kind: "message", amountCents: 999 },
        ],
        transactions: [],
        fans: [],
      },
    ],
    alerts: [],
    alertLabels: ["Alba"],
  });
  assert.equal(figures.cards.ppv.value, "$2.50");
  assert.equal(figures.cards.tips.value, SIN_DATOS);
  assert.equal(figures.cards.ingresos.value, "$2.50");
});

test("un miembro no guarda otra configuración de widgets", () => {
  const prev = emptyWorkspace();
  const same = { ...prev, dashboardConfig: defaultDashboardConfig() };
  assert.doesNotThrow(() => assertWorkspaceChange(chatter, prev, same));
  const hidden = setWidgetVisible(defaultDashboardConfig(), "alertas", false);
  assert.throws(() => assertWorkspaceChange(chatter, prev, { ...prev, dashboardConfig: hidden }), WorkspaceAccessError);
  assert.doesNotThrow(() => assertWorkspaceChange(owner, prev, { ...prev, dashboardConfig: hidden }));
});
