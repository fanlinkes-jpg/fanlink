import assert from "node:assert/strict";
import { test } from "node:test";
import type { TeamAccess } from "./access-policy.ts";
import {
  NAV_LINKS,
  canAccessPath,
  canOpenMessagePanel,
  canOpenReports,
  dashboardZone,
  legacyRedirect,
  navRoleFromAccess,
  reportBodyKind,
  reportHash,
  reportTabsFor,
  visibleFunctionTabs,
  visibleNavBlocks,
} from "./nav-config.ts";

const ownerAccess: TeamAccess = { userId: "owner", role: "owner", perms: [], creatorIds: [] };
const chatterAccess: TeamAccess = {
  userId: "chatter",
  role: "member",
  perms: ["mensajes", "precios", "vault", "campanas", "analitica", "equipo", "ajustes"],
  creatorIds: ["c-alba"],
};
const chatterLimited: TeamAccess = { userId: "chatter", role: "member", perms: ["mensajes"], creatorIds: ["c-alba"] };
const chatterVault: TeamAccess = { userId: "chatter", role: "member", perms: ["vault"], creatorIds: ["c-alba"] };

function ids(role: "owner" | "manager" | "chatter" | "model", access: TeamAccess | null) {
  return visibleNavBlocks(role, access).map((block) => block.id);
}

test("el menú son siete secciones, sin submenús, en el orden acordado", () => {
  assert.deepEqual(
    NAV_LINKS.map((block) => block.id),
    ["dashboard", "operativa", "chat", "funciones-inteligentes", "administrar", "proxys", "configuracion"],
  );
  assert.deepEqual(
    NAV_LINKS.map((block) => block.label),
    ["Dashboard", "Operativa", "Chat", "Funciones inteligentes", "Administrar", "Proxys", "Configuración"],
  );
});

test("la dueña ve las siete secciones y la operativa", () => {
  assert.equal(navRoleFromAccess(ownerAccess), "owner");
  assert.deepEqual(ids("owner", ownerAccess), NAV_LINKS.map((block) => block.id));
  assert.equal(canAccessPath("/notificaciones", "owner", ownerAccess), true);
  assert.equal(canOpenReports("owner", ownerAccess), true);
  assert.equal(canOpenMessagePanel("owner", ownerAccess), true);
});

test("el rol de menú manager ve Configuración, pero la sesión no lo fabrica", () => {
  assert.equal(navRoleFromAccess({ role: "member" }), "chatter");
  assert.equal(navRoleFromAccess(null), null);
  assert.notEqual(navRoleFromAccess(chatterAccess), "manager");
  assert.equal(canAccessPath("/configuracion", navRoleFromAccess(chatterAccess), chatterAccess), false);
  const seen = ids("manager", ownerAccess);
  assert.equal(seen.includes("dashboard"), true);
  assert.equal(seen.includes("administrar"), true);
  assert.equal(seen.includes("proxys"), true);
  assert.equal(seen.includes("configuracion"), true);
  assert.equal(seen.includes("operativa"), false);
  assert.equal(seen.includes("informes"), false);
  assert.equal(canAccessPath("/configuracion", "manager", ownerAccess), true);
  assert.equal(canAccessPath("/ajustes", "manager", ownerAccess), true);
  assert.equal(canOpenReports("manager", ownerAccess), true);
  assert.equal(canOpenMessagePanel("manager", ownerAccess), true);
  assert.equal(canAccessPath("/notificaciones", "manager", ownerAccess), false);
});

test("el chatter no ve totales de agencia en el menú, ni banco, ni estados, ni administrar, ni configuración", () => {
  assert.equal(navRoleFromAccess(chatterAccess), "chatter");
  const seen = ids("chatter", chatterAccess);
  assert.equal(seen.includes("dashboard"), true);
  assert.equal(seen.includes("chat"), true);
  assert.equal(seen.includes("funciones-inteligentes"), true);
  assert.equal(seen.includes("operativa"), false);
  assert.equal(seen.includes("administrar"), false);
  assert.equal(seen.includes("proxys"), false);
  assert.equal(seen.includes("configuracion"), false);
  assert.equal(seen.includes("banco"), false);
  assert.equal(seen.includes("estados-cuenta"), false);
  assert.equal(seen.includes("informes"), false);
  assert.equal(canOpenReports("chatter", chatterAccess), true);
  assert.equal(canOpenMessagePanel("chatter", chatterAccess), false);
  assert.equal(canAccessPath("/notificaciones", "chatter", chatterAccess), false);
  assert.equal(canAccessPath("/administrar", "chatter", chatterAccess), false);
  assert.equal(canAccessPath("/proxys", "chatter", chatterAccess), false);
  assert.equal(canAccessPath("/configuracion", "chatter", chatterAccess), false);
  assert.equal(canAccessPath("/ajustes", "chatter", chatterAccess), false);
  assert.equal(canAccessPath("/proximamente/facturacion", "chatter", chatterAccess), false);
  assert.equal(canAccessPath("/auditoria", "chatter", chatterAccess), false);
  assert.equal(canAccessPath("/analitica", "chatter", chatterAccess), true);
  assert.equal(canAccessPath("/mensajes", "chatter", chatterAccess), true);
  assert.equal(canAccessPath("/creadoras", "chatter", chatterAccess), false);
  assert.equal(canAccessPath("/equipo", "chatter", chatterAccess), false);
});

test("el chatter sigue sujeto a los permisos existentes", () => {
  const seen = ids("chatter", chatterLimited);
  assert.equal(seen.includes("chat"), true);
  assert.equal(seen.includes("funciones-inteligentes"), false);
  assert.equal(canOpenReports("chatter", chatterLimited), false);
  assert.equal(canAccessPath("/analitica", "chatter", chatterLimited), false);
  assert.equal(canAccessPath("/vault", "chatter", chatterLimited), false);
  assert.equal(canAccessPath("/funciones", "chatter", chatterLimited), false);
  assert.deepEqual(visibleFunctionTabs("chatter", chatterVault), ["vault"]);
  assert.equal(ids("chatter", chatterVault).includes("funciones-inteligentes"), true);
});

test("la modelo no ve funciones, administrar, proxys ni configuración", () => {
  const seen = ids("model", ownerAccess);
  assert.equal(seen.includes("funciones-inteligentes"), false);
  assert.equal(seen.includes("administrar"), false);
  assert.equal(seen.includes("proxys"), false);
  assert.equal(seen.includes("configuracion"), false);
  assert.equal(seen.includes("operativa"), false);
  assert.equal(seen.includes("dashboard"), true);
  assert.equal(seen.includes("chat"), true);
});

test("ReportsPanel: un chatter con #informes-mensajes no ve el panel", () => {
  const role = navRoleFromAccess(chatterAccess);
  const zone = dashboardZone("#informes-mensajes");
  assert.equal(zone.kind, "informes");
  if (zone.kind !== "informes") return;
  assert.equal(zone.vista, "mensajes");
  const panelOk = canOpenMessagePanel(role, chatterAccess);
  assert.equal(panelOk, false);
  assert.deepEqual(reportTabsFor(panelOk), ["creadoras", "equipo", "fans"]);
  assert.equal(reportBodyKind(zone.vista, panelOk), "denied");
  assert.equal(reportBodyKind("mensajes", canOpenMessagePanel("owner", ownerAccess)), "audit");
  assert.equal(reportBodyKind("fans", true), "analytics");
});

test("la analítica y el resto de rutas viejas apuntan a su sitio nuevo", () => {
  assert.deepEqual(legacyRedirect("/analitica", {}), { to: "/", hash: "informes" });
  assert.deepEqual(legacyRedirect("/analitica", { vista: "equipo" }), { to: "/", hash: "informes-equipo" });
  assert.deepEqual(legacyRedirect("/analitica", { vista: "fans" }), { to: "/", hash: "informes-fans" });
  assert.deepEqual(legacyRedirect("/auditoria"), { to: "/", hash: reportHash("mensajes") });
  assert.deepEqual(legacyRedirect("/ajustes"), { to: "/configuracion", hash: "ajustes" });
  assert.deepEqual(legacyRedirect("/proximamente/facturacion"), { to: "/configuracion", hash: "facturacion" });
  assert.deepEqual(legacyRedirect("/creadoras"), { to: "/administrar", search: { tab: "creadoras" } });
  assert.deepEqual(legacyRedirect("/equipo"), { to: "/administrar", search: { tab: "chatters" } });
  assert.deepEqual(legacyRedirect("/campanas"), { to: "/funciones", search: { tab: "masivos" } });
  assert.deepEqual(legacyRedirect("/listas"), { to: "/funciones", search: { tab: "listas" } });
  assert.deepEqual(legacyRedirect("/automatizaciones"), { to: "/funciones", search: { tab: "auto-seguir" } });
  assert.deepEqual(legacyRedirect("/vault"), { to: "/funciones", search: { tab: "vault" } });
  assert.deepEqual(legacyRedirect("/guiones"), { to: "/funciones", search: { tab: "guiones" } });
  assert.deepEqual(legacyRedirect("/enlaces"), { to: "/funciones", search: { tab: "enlaces" } });
  assert.deepEqual(legacyRedirect("/proximamente/promocion-perfil"), { to: "/funciones", search: { tab: "promocion" } });
  assert.deepEqual(legacyRedirect("/proximamente/enlaces-prueba"), { to: "/funciones", search: { tab: "prueba" } });
  assert.equal(legacyRedirect("/notificaciones"), null);
  assert.deepEqual(dashboardZone("#informes-fans"), { kind: "informes", vista: "fans" });
  assert.deepEqual(dashboardZone("#resumen"), { kind: "metricas", screen: "resumen" });
  assert.deepEqual(dashboardZone(""), { kind: "metricas", screen: "resumen" });
});
