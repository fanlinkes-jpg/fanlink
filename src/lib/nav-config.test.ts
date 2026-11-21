import assert from "node:assert/strict";
import { test } from "node:test";
import type { TeamAccess } from "./access-policy.ts";
import {
  NAV_BLOCKS,
  allNavLinks,
  canAccessPath,
  comingSoonSection,
  navRoleFromAccess,
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

function ids(role: "owner" | "manager" | "chatter" | "model", access: TeamAccess | null) {
  return visibleNavBlocks(role, access).map((block) => block.id);
}

function linkIds(role: "owner" | "manager" | "chatter" | "model", access: TeamAccess | null) {
  return visibleNavBlocks(role, access).flatMap((block) => (block.kind === "link" ? [block.id] : block.items.map((item) => item.id)));
}

test("los bloques del menú siguen el orden acordado", () => {
  assert.deepEqual(
    NAV_BLOCKS.map((block) => block.id),
    ["dashboard", "operativa", "chat", "estadisticas", "informes", "funciones-inteligentes", "administrar", "proxys", "ajustes-app"],
  );
});

test("Informes, Funciones inteligentes y Ajustes conservan el orden de las secciones", () => {
  const byId = new Map(NAV_BLOCKS.map((block) => [block.id, block]));
  const groupIds = (id: string) => {
    const block = byId.get(id);
    assert.ok(block && block.kind === "group");
    return block.items.map((item) => item.id);
  };
  assert.equal(byId.get("operativa")?.kind, "link");
  assert.deepEqual(groupIds("informes"), [
    "informes-creador",
    "informes-empleados",
    "informes-fans",
    "panel-mensajes",
  ]);
  assert.deepEqual(groupIds("funciones-inteligentes"), [
    "mensajes-masivos",
    "listas-inteligentes",
    "auto-seguir",
    "vault-pro",
    "guiones",
    "promocion-perfil",
    "enlaces-prueba",
    "enlaces-seguimiento",
  ]);
  assert.deepEqual(groupIds("ajustes-app"), ["cuenta", "facturacion"]);
});

test("el rol de la dueña ve todos los bloques y la facturación", () => {
  assert.equal(navRoleFromAccess(ownerAccess), "owner");
  assert.deepEqual(ids("owner", ownerAccess), NAV_BLOCKS.map((block) => block.id));
  assert.equal(linkIds("owner", ownerAccess).includes("facturacion"), true);
  assert.equal(linkIds("owner", ownerAccess).includes("administrar"), true);
  assert.equal(linkIds("owner", ownerAccess).includes("proxys"), true);
  assert.equal(linkIds("owner", ownerAccess).includes("operativa"), true);
  assert.equal(canAccessPath("/notificaciones", "owner", ownerAccess), true);
});

test("el mánager ve la agencia pero no la facturación", () => {
  const seen = linkIds("manager", ownerAccess);
  assert.equal(ids("manager", ownerAccess).includes("informes"), true);
  assert.equal(ids("manager", ownerAccess).includes("administrar"), true);
  assert.equal(ids("manager", ownerAccess).includes("proxys"), true);
  assert.equal(seen.includes("facturacion"), false);
  assert.equal(seen.includes("notificaciones"), false);
  assert.equal(seen.includes("cuenta"), true);
});

test("el chatter no ve informes de agencia, administrar, proxys ni facturación", () => {
  assert.equal(navRoleFromAccess(chatterAccess), "chatter");
  const blocks = ids("chatter", chatterAccess);
  const seen = linkIds("chatter", chatterAccess);
  assert.equal(blocks.includes("informes"), false);
  assert.equal(blocks.includes("administrar"), false);
  assert.equal(blocks.includes("proxys"), false);
  assert.equal(seen.includes("facturacion"), false);
  assert.equal(seen.includes("estados-cuenta"), false);
  assert.equal(seen.includes("banco"), false);
  assert.equal(seen.includes("release-forms"), false);
  assert.equal(blocks.includes("dashboard"), true);
  assert.equal(blocks.includes("operativa"), false);
  assert.equal(blocks.includes("chat"), true);
  assert.equal(seen.includes("chat"), true);
  assert.equal(seen.includes("operativa"), false);
  assert.equal(seen.includes("estadisticas"), true);
  assert.equal(seen.includes("cuenta"), true);
  assert.equal(canAccessPath("/notificaciones", "chatter", chatterAccess), false);
  assert.equal(canAccessPath("/administrar", "chatter", chatterAccess), false);
  assert.equal(canAccessPath("/proxys", "chatter", chatterAccess), false);
  assert.equal(canAccessPath("/proximamente/facturacion", "chatter", chatterAccess), false);
  assert.equal(canAccessPath("/analitica", "chatter", chatterAccess), true);
  assert.equal(canAccessPath("/mensajes", "chatter", chatterAccess), true);
  assert.equal(canAccessPath("/creadoras", "chatter", chatterAccess), false);
  assert.equal(canAccessPath("/equipo", "chatter", chatterAccess), false);
});

test("el chatter sigue sujeto a los permisos existentes", () => {
  const seen = linkIds("chatter", chatterLimited);
  assert.equal(seen.includes("chat"), true);
  assert.equal(seen.includes("estadisticas"), false);
  assert.equal(seen.includes("boveda"), false);
  assert.equal(seen.includes("mensajes-masivos"), false);
  assert.equal(seen.includes("cuenta"), false);
  assert.equal(canAccessPath("/analitica", "chatter", chatterLimited), false);
  assert.equal(canAccessPath("/vault", "chatter", chatterLimited), false);
});

test("la modelo no ve informes, funciones inteligentes, administrar, proxys ni facturación", () => {
  const blocks = ids("model", ownerAccess);
  const seen = linkIds("model", ownerAccess);
  assert.equal(blocks.includes("informes"), false);
  assert.equal(blocks.includes("funciones-inteligentes"), false);
  assert.equal(blocks.includes("administrar"), false);
  assert.equal(blocks.includes("proxys"), false);
  assert.equal(seen.includes("facturacion"), false);
  assert.equal(blocks.includes("dashboard"), true);
  assert.equal(blocks.includes("operativa"), false);
  assert.equal(blocks.includes("chat"), true);
});

test("las secciones sin pantalla propia quedan como Próximamente", () => {
  const coming = allNavLinks().filter((item) => item.comingSoon).map((item) => item.id);
  assert.deepEqual(coming, [
    "promocion-perfil",
    "enlaces-prueba",
    "facturacion",
  ]);
  assert.equal(comingSoonSection("nuevo-post"), undefined);
  assert.equal(comingSoonSection("facturacion")?.roles.includes("chatter"), false);
});
