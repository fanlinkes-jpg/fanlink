import { hasPerm, type TeamAccess, type TeamPerm } from "./access-policy.ts";

export const NAV_ROLES = ["owner", "manager", "chatter", "model"] as const;
export type NavRole = (typeof NAV_ROLES)[number];

/** Dueña y mánager: secciones de agencia que el chatter no debe ver. */
export const AGENCY_ROLES = ["owner", "manager"] as const;
export const STAFF_ROLES = ["owner", "manager", "chatter"] as const;
export const ALL_NAV_ROLES = NAV_ROLES;
export const OWNER_ROLES = ["owner"] as const;

export type NavSearch = Record<string, string>;

export type NavLink = {
  id: string;
  label: string;
  hint: string;
  to: string;
  params?: Record<string, string>;
  search?: NavSearch;
  roles: readonly NavRole[];
  perm?: TeamPerm;
  comingSoon?: boolean;
};

export type NavGroup = {
  kind: "group";
  id: string;
  label: string;
  items: NavLink[];
};

export type NavBlock = ({ kind: "link" } & NavLink) | NavGroup;

function link(
  id: string,
  label: string,
  hint: string,
  to: string,
  roles: readonly NavRole[],
  perm?: TeamPerm,
  search?: NavSearch,
): NavLink {
  return { id, label, hint, to, roles, perm, search };
}

function soon(
  id: string,
  label: string,
  hint: string,
  roles: readonly NavRole[],
  perm?: TeamPerm,
): NavLink {
  return {
    id,
    label,
    hint,
    roles,
    perm,
    comingSoon: true,
    to: "/proximamente/$seccion",
    params: { seccion: id },
  };
}

function item(
  kind: "link",
  id: string,
  label: string,
  hint: string,
  to: string,
  roles: readonly NavRole[],
  perm?: TeamPerm,
): NavBlock {
  return { kind, id, label, hint, to, roles, perm };
}

export const NAV_BLOCKS: NavBlock[] = [
  item("link", "dashboard", "Dashboard general", "Inicio con resumen", "/", ALL_NAV_ROLES),
  item("link", "operativa", "Operativa", "Página real de OnlyFans", "/notificaciones", OWNER_ROLES),
  {
    ...item("link", "chat", "Chat", "Conversaciones en curso", "/mensajes", ALL_NAV_ROLES, "mensajes"),
  },
  item("link", "estadisticas", "Estadísticas", "Rendimiento", "/analitica", ALL_NAV_ROLES, "analitica"),
  {
    kind: "group",
    id: "informes",
    label: "Informes",
    items: [
      link("informes-creador", "Informes de creador", "Por cuenta", "/analitica", AGENCY_ROLES, "analitica", { vista: "creadoras" }),
      link("informes-empleados", "Informes de empleados", "Por chatter", "/analitica", AGENCY_ROLES, "analitica", { vista: "equipo" }),
      link("informes-fans", "Informes de fans", "Gasto y riesgo", "/analitica", AGENCY_ROLES, "analitica", { vista: "fans" }),
      link("panel-mensajes", "Panel de mensajes", "Calidad de la bandeja", "/auditoria", AGENCY_ROLES, "analitica"),
    ],
  },
  {
    kind: "group",
    id: "funciones-inteligentes",
    label: "Funciones inteligentes",
    items: [
      link("mensajes-masivos", "Mensajes masivos", "Masivos por precio", "/campanas", STAFF_ROLES, "campanas"),
      link("listas-inteligentes", "Listas inteligentes", "Segmentos de fans", "/listas", STAFF_ROLES, "campanas"),
      link("auto-seguir", "Auto-seguir", "Reglas automáticas", "/automatizaciones", STAFF_ROLES, "campanas"),
      link("vault-pro", "Vault Pro", "Ranking de sets", "/vault", STAFF_ROLES, "vault"),
      link("guiones", "Guiones", "Textos del equipo", "/guiones", STAFF_ROLES, "campanas"),
      soon("promocion-perfil", "Promoción de perfil", "Pruebas y campañas", STAFF_ROLES, "campanas"),
      soon("enlaces-prueba", "Enlaces de prueba gratuita", "Acceso gratuito", STAFF_ROLES, "campanas"),
      link("enlaces-seguimiento", "Enlaces de seguimiento", "Pruebas y clics", "/enlaces", STAFF_ROLES, "campanas"),
    ],
  },
  item("link", "administrar", "Administrar", "Creadores y equipos", "/administrar", AGENCY_ROLES, "equipo"),
  item("link", "proxys", "Proxys", "IP de cada cuenta", "/proxys", AGENCY_ROLES, "equipo"),
  {
    kind: "group",
    id: "ajustes-app",
    label: "Ajustes de la app",
    items: [
      link("cuenta", "Cuenta", "Ajustes de Fanlink", "/ajustes", ALL_NAV_ROLES, "ajustes"),
      soon("facturacion", "Facturación", "Plan y pagos", OWNER_ROLES),
    ],
  },
];

/** Rutas antiguas de administración que siguen existiendo fuera del menú nuevo. */
const LEGACY_GATED_PATHS: Array<{ prefix: string; roles: readonly NavRole[]; perm?: TeamPerm }> = [
  { prefix: "/creadoras", roles: AGENCY_ROLES, perm: "equipo" },
  { prefix: "/equipo", roles: AGENCY_ROLES, perm: "equipo" },
  { prefix: "/conectar", roles: AGENCY_ROLES, perm: "equipo" },
];

export function navRoleFromAccess(access: Pick<TeamAccess, "role"> | null | undefined): NavRole | null {
  if (!access) return null;
  if (access.role === "owner") return "owner";
  return "chatter";
}

export function allNavLinks(): NavLink[] {
  return NAV_BLOCKS.flatMap((block) => (block.kind === "link" ? [block] : block.items));
}

export function comingSoonSection(seccion: string): NavLink | undefined {
  return allNavLinks().find((item) => item.comingSoon && item.params?.seccion === seccion);
}

export function isNavLinkVisible(item: NavLink, role: NavRole | null, access: TeamAccess | null): boolean {
  if (!role || !item.roles.includes(role)) return false;
  if (item.perm && !hasPerm(access, item.perm)) return false;
  return true;
}

export function visibleNavBlocks(role: NavRole | null, access: TeamAccess | null): NavBlock[] {
  const blocks: NavBlock[] = [];
  for (const block of NAV_BLOCKS) {
    if (block.kind === "link") {
      if (isNavLinkVisible(block, role, access)) blocks.push(block);
      continue;
    }
    const items = block.items.filter((item) => isNavLinkVisible(item, role, access));
    if (items.length > 0) blocks.push({ ...block, items });
  }
  return blocks;
}

export function navPathOf(item: NavLink): string {
  const path = item.params?.seccion && item.to === "/proximamente/$seccion"
    ? `/proximamente/${item.params.seccion}`
    : item.to;
  if (!item.search) return path;
  const query = new URLSearchParams(item.search).toString();
  return query ? `${path}?${query}` : path;
}

export function pathMatchesNavLink(pathname: string, item: NavLink): boolean {
  const path = navPathOf(item).split("?")[0] ?? item.to;
  if (path === "/") return pathname === "/";
  return pathname === path || pathname.startsWith(`${path}/`);
}

export function canAccessPath(pathname: string, role: NavRole | null, access: TeamAccess | null): boolean {
  if (!role) return false;
  const matches = allNavLinks().filter((item) => pathMatchesNavLink(pathname, item));
  if (matches.length > 0) return matches.some((item) => isNavLinkVisible(item, role, access));
  const legacy = LEGACY_GATED_PATHS.find((item) => pathname === item.prefix || pathname.startsWith(`${item.prefix}/`));
  if (!legacy) return true;
  if (!legacy.roles.includes(role)) return false;
  if (legacy.perm && !hasPerm(access, legacy.perm)) return false;
  return true;
}
