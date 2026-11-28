import { TEAM_PERMS, type TeamPerm } from "./access-policy.ts";
import type { StaffLevel } from "./staff-levels.ts";

/** Permisos agrupados como en el pop-up del rol. Cada permiso sale en un único grupo. */
export const PERM_GROUPS: ReadonlyArray<{ id: string; label: string; perms: readonly TeamPerm[] }> = [
  { id: "workspace", label: "Workspace", perms: ["todas", "vault", "campanas"] },
  { id: "team", label: "Team Mgmt", perms: ["equipo"] },
  { id: "analytics", label: "Analytics", perms: ["analitica", "estadisticas"] },
  { id: "chat", label: "Chat", perms: ["mensajes", "precios"] },
  { id: "settings", label: "Account Settings", perms: ["ajustes"] },
  { id: "statements", label: "Statements", perms: ["banco", "estados"] },
];

export const PERM_LABELS: Record<TeamPerm, string> = {
  todas: "Todas las creadoras y todos los chats",
  vault: "Vault",
  campanas: "Campañas y listas",
  equipo: "Equipo",
  analitica: "Analítica",
  estadisticas: "Cifras de la agencia (totales e ingresos)",
  mensajes: "Mensajes",
  precios: "Precios",
  ajustes: "Ajustes",
  banco: "Banco",
  estados: "Estados de cuenta",
};

const ALL: readonly TeamPerm[] = TEAM_PERMS;

/**
 * Permisos con los que entra cada rol. Un empleado con varios roles recibe la suma.
 * Admin: acceso total, con el dinero de la agencia (Banco y Estados de cuenta).
 * Supervisor: ve todo, incluido el dinero, pero no cambia los ajustes de la cuenta.
 * El chatter solo ve sus creadoras y sus cifras: nunca totales de agencia, Banco, Estadísticas ni Estados.
 */
export const ROLE_PRESETS: Record<StaffLevel, readonly TeamPerm[]> = {
  owner: ALL,
  admin: ALL,
  supervisor: ["todas", "vault", "campanas", "equipo", "analitica", "estadisticas", "mensajes", "precios", "banco", "estados"],
  team_manager: ["vault", "campanas", "equipo", "analitica", "mensajes", "precios"],
  account_manager: ["vault", "campanas", "analitica", "mensajes", "precios"],
  analyst: ["todas", "analitica", "estadisticas"],
  chatter: ["mensajes"],
};

/** El chatter nunca recibe estos, ni marcándolos a mano: el servidor los quita. */
export const CHATTER_DENIED: readonly TeamPerm[] = ["estadisticas", "banco", "estados", "todas"];

function onlyChatter(roles: readonly StaffLevel[]): boolean {
  return roles.length > 0 && roles.every((role) => role === "chatter");
}

export function presetPerms(roles: readonly StaffLevel[]): TeamPerm[] {
  return TEAM_PERMS.filter((perm) => roles.some((role) => ROLE_PRESETS[role].includes(perm)));
}

/** Quita lo que el servidor no concede a esos roles. */
export function restrictPerms(roles: readonly StaffLevel[], perms: readonly string[]): TeamPerm[] {
  if (roles.includes("owner")) return [...TEAM_PERMS];
  const clean = TEAM_PERMS.filter((perm) => perms.includes(perm));
  return onlyChatter(roles) ? clean.filter((perm) => !CHATTER_DENIED.includes(perm)) : clean;
}

/**
 * Permisos finales de un empleado. Sin lista pedida, el preset de sus roles. Con lista, la que se marcó
 * en el pop-up (preset más lo marcado), guardada por empleado, siempre pasada por `restrictPerms`.
 */
export function effectivePerms(roles: readonly StaffLevel[], requested?: readonly string[] | null): TeamPerm[] {
  return restrictPerms(roles, requested ?? presetPerms(roles));
}

export function isPermLocked(roles: readonly StaffLevel[], perm: TeamPerm): boolean {
  return onlyChatter(roles) && CHATTER_DENIED.includes(perm);
}

const CAN: Record<TeamPerm, string> = {
  mensajes: "escribir en los chats",
  precios: "poner precios",
  vault: "usar el vault",
  campanas: "crear campañas y listas",
  analitica: "ver la analítica",
  equipo: "gestionar el equipo",
  ajustes: "cambiar los ajustes",
  todas: "ver todas las creadoras y todos los chats",
  estadisticas: "ver las cifras y el dinero de la agencia",
  banco: "abrir el Banco",
  estados: "ver los Estados de cuenta",
};

const CANNOT: Partial<Record<TeamPerm, string>> = {
  todas: "ver creadoras que no tenga asignadas",
  estadisticas: "ver totales ni dinero de la agencia",
  banco: "abrir el Banco",
  estados: "ver los Estados de cuenta",
  ajustes: "cambiar los ajustes",
  equipo: "gestionar el equipo",
};

/** Resumen legible de lo que podrá y no podrá hacer con estos permisos. */
export function describePerms(perms: readonly string[]): { can: string[]; cannot: string[] } {
  const can = TEAM_PERMS.filter((perm) => perms.includes(perm)).map((perm) => CAN[perm]);
  const cannot = TEAM_PERMS.filter((perm) => !perms.includes(perm)).flatMap((perm) => (CANNOT[perm] ? [CANNOT[perm] as string] : []));
  return { can, cannot };
}
