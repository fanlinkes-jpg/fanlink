import assert from "node:assert/strict";
import { test } from "node:test";
import { buildInsightsView, normalizeInsightRequest } from "./insights-view.ts";
import { CUT, NOW, QUERY, fixture } from "../../../src/lib/dashboard-insights.test-fixture.ts";
import { presetPerms, restrictPerms } from "../../../src/lib/staff-roles.ts";

const updated = { cutAt: CUT.toISOString(), lastReadAt: null, nextCutAt: null, cutsEnabled: true, hours: [0, 8, 16] };
const view = (access: { userId: string; role: "owner" | "member"; perms: string[] }, creatorId = "all", tag = "all") =>
  buildInsightsView({ access, data: fixture(), query: { ...QUERY, creatorId, tag }, cutAt: CUT, now: NOW, updated, lastReads: new Map() });

test("Admin y Supervisor ven todo, incluido el dinero de la agencia (no se tratan como chatter)", () => {
  for (const level of ["admin", "supervisor"] as const) {
    const perms = restrictPerms([level], presetPerms([level]));
    const result = view({ userId: `u-${level}`, role: "member", perms });
    assert.equal(result.agency, true, level);
    assert.equal(result.summary?.kpis.total.value, 13_600, level);
    assert.ok(result.creatorTable, level);
    assert.ok(result.daily, level);
    assert.equal(result.chatters.totalCents, 13_600, level);
    assert.equal(result.chatters.rows.length, 2, level);
  }
  assert.equal(view({ userId: "owner", role: "owner", perms: [] }).agency, true);
});

test("Chatter: solo sus números; nunca totales de agencia, tabla por creadora ni comparativa", () => {
  // Aunque la ficha traiga «estadisticas», un chatter lo pierde al leer el acceso.
  const perms = restrictPerms(["chatter"], [...presetPerms(["chatter"]), "estadisticas"]);
  const result = view({ userId: "u-chat", role: "member", perms });
  assert.equal(result.agency, false);
  assert.equal(result.summary, null);
  assert.equal(result.creatorTable, null);
  assert.equal(result.daily, null);
  assert.equal(result.chatters.totalCents, null);
  assert.equal(result.chatters.unattributedCents, null);
  assert.deepEqual(result.chatters.rows.map((row) => row.userId), ["u-chat"]);
  assert.deepEqual(result.chatters.top.map((row) => row.userId), ["u-chat"]);
  assert.equal(result.mine?.salesCents, 12_000);
  assert.equal(result.alerts.some((alert) => alert.kind === "drop"), false);
  assert.equal(result.alerts.some((alert) => alert.text.startsWith("Otro:")), false);
  for (const row of result.chatters.series) assert.deepEqual(Object.keys(row).sort(), ["label", "u-chat"]);
  assert.equal(JSON.stringify(result).includes("13600"), false);
});

test("filtro por creadora: nunca se mezclan creadoras", () => {
  const result = view({ userId: "owner", role: "owner", perms: [] }, "c-nora");
  assert.equal(result.summary?.kpis.total.value, 1_600);
  assert.equal(result.segments.fans.every((fan) => fan.creatorId === "c-nora"), true);
  assert.deepEqual(result.creatorTable?.rows.map((row) => row.creatorId), ["c-nora"]);
  assert.equal(result.chatters.rows.every((row) => row.userId === "u-otro"), true);
  const byTag = view({ userId: "owner", role: "owner", perms: [] }, "all", "vip");
  assert.deepEqual(byTag.creatorTable?.rows.map((row) => row.creatorId), ["c-alba"]);
});

test("la petición se limpia: neto por defecto, rango máximo y nunca después de hoy", () => {
  const query = normalizeInsightRequest({ from: "2020-01-01", to: "2030-01-01", basis: "otro" }, NOW);
  assert.equal(query.basis, "net");
  assert.equal(query.to, "2026-11-28");
  assert.equal(query.from, "2025-11-28");
  assert.equal(normalizeInsightRequest(null, NOW).creatorId, "all");
});
