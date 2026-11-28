import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { isRedirect } from "@tanstack/react-router";
import { legacyRedirectThrow } from "./route-redirect.ts";

function routeSource(name: string): string {
  return readFileSync(new URL(`../routes/${name}`, import.meta.url), "utf8");
}

function redirectOf(pathname: string, search: Record<string, unknown> = {}): { to?: string; hash?: string; search?: Record<string, unknown> } {
  try {
    legacyRedirectThrow(pathname, search);
  } catch (error) {
    assert.equal(isRedirect(error), true);
    const options = (error as { options?: { to?: string; hash?: string; search?: Record<string, unknown> } }).options;
    assert.ok(options);
    return { to: options.to, hash: options.hash, search: options.search };
  }
  assert.fail(`${pathname} debía redirigir`);
}

test("el beforeLoad de Analítica, Auditoría y Ajustes redirige al sitio nuevo", () => {
  assert.match(routeSource("analitica.tsx"), /beforeLoad:[\s\S]*legacyRedirectThrow\("\/analitica", search\)/);
  assert.match(routeSource("auditoria.tsx"), /beforeLoad:[\s\S]*legacyRedirectThrow\("\/auditoria"\)/);
  assert.match(routeSource("ajustes.tsx"), /beforeLoad:[\s\S]*legacyRedirectThrow\("\/ajustes"\)/);
  assert.deepEqual(redirectOf("/analitica"), { to: "/", hash: "informes", search: undefined });
  assert.deepEqual(redirectOf("/analitica", { vista: "equipo" }), { to: "/", hash: "informes-equipo", search: undefined });
  assert.deepEqual(redirectOf("/analitica", { vista: "fans" }), { to: "/", hash: "informes-fans", search: undefined });
  assert.deepEqual(redirectOf("/auditoria"), { to: "/", hash: "informes-mensajes", search: undefined });
  assert.deepEqual(redirectOf("/ajustes"), { to: "/configuracion", hash: "ajustes", search: undefined });
});

test("el beforeLoad de Personal y de Mensajes inteligentes redirige", () => {
  assert.match(routeSource("creadoras.tsx"), /legacyRedirectThrow\("\/creadoras"\)/);
  assert.match(routeSource("equipo.tsx"), /legacyRedirectThrow\("\/equipo"\)/);
  assert.match(routeSource("campanas.tsx"), /legacyRedirectThrow\("\/campanas"\)/);
  assert.match(routeSource("listas.tsx"), /legacyRedirectThrow\("\/listas"\)/);
  assert.match(routeSource("automatizaciones.tsx"), /legacyRedirectThrow\("\/automatizaciones"\)/);
  assert.match(routeSource("vault.tsx"), /legacyRedirectThrow\("\/vault"\)/);
  assert.match(routeSource("guiones.tsx"), /legacyRedirectThrow\("\/guiones"\)/);
  assert.match(routeSource("enlaces.tsx"), /legacyRedirectThrow\("\/enlaces"\)/);
  assert.match(routeSource("proximamente.$seccion.tsx"), /legacyRedirectThrow\(path\)/);
  assert.deepEqual(redirectOf("/creadoras"), { to: "/administrar", hash: undefined, search: { tab: "creadoras" } });
  assert.deepEqual(redirectOf("/equipo"), { to: "/administrar", hash: undefined, search: { tab: "empleados" } });
  assert.deepEqual(redirectOf("/campanas"), { to: "/funciones", hash: undefined, search: { tab: "masivos" } });
  assert.deepEqual(redirectOf("/listas"), { to: "/funciones", hash: undefined, search: { tab: "listas" } });
  assert.deepEqual(redirectOf("/automatizaciones"), { to: "/funciones", hash: undefined, search: { tab: "auto-seguir" } });
  assert.deepEqual(redirectOf("/vault"), { to: "/funciones", hash: undefined, search: { tab: "vault" } });
  assert.deepEqual(redirectOf("/guiones"), { to: "/funciones", hash: undefined, search: { tab: "guiones" } });
  assert.deepEqual(redirectOf("/enlaces"), { to: "/funciones", hash: undefined, search: { tab: "enlaces" } });
  assert.deepEqual(redirectOf("/proximamente/facturacion"), { to: "/configuracion", hash: "facturacion", search: undefined });
  assert.deepEqual(redirectOf("/proximamente/promocion-perfil"), { to: "/funciones", hash: undefined, search: { tab: "promocion" } });
  assert.deepEqual(redirectOf("/proximamente/enlaces-prueba"), { to: "/funciones", hash: undefined, search: { tab: "prueba" } });
});
