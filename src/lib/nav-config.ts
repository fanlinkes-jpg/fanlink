import { hasPerm, type TeamAccess, type TeamPerm } from "./access-policy.ts";
import { parseScreen, type ScreenId } from "./dashboard-config.ts";

export const NAV_ROLES = ["owner", "manager", "chatter", "model"] as const;
export type NavRole = (typeof NAV_ROLES)[number];

/** Dueña y admin: secciones de agencia que el chatter no debe ver. */
export const AGENCY_ROLES = ["owner", "manager"] as const;
export const STAFF_ROLES = ["owner", "manager", "chatter"] as const;
export const ALL_NAV_ROLES = NAV_ROLES;
export const OWNER_ROLES = ["owner"] as const;

export const REPORT_VIEWS = ["creadoras", "equipo", "fans", "mensajes"] as const;
export type ReportView = (typeof REPORT_VIEWS)[number];

export const FUNCTION_TABS = [
  { id: "masivos", label: "Mensajes masivos", perm: "campanas" },
  { id: "listas", label: "Listas inteligentes", perm: "campanas" },
  { id: "auto-seguir", label: "Auto-seguir", perm: "campanas" },
  { id: "vault", label: "Vault Pro", perm: "vault" },
  { id: "guiones", label: "Guiones", perm: "campanas" },
  { id: "promocion", label: "Promoción de perfil", perm: "campanas" },
  { id: "prueba", label: "Enlaces de prueba gratuita", perm: "campanas" },
  { id: "enlaces", label: "Enlaces de seguimiento", perm: "campanas" },
] as const;

export type FunctionTabId = (typeof FUNCTION_TABS)[number]["id"];
export type AdminTab = "creadoras" | "chatters";

export type DashboardZone =
  | { kind: "metricas"; screen: ScreenId }
  | { kind: "informes"; vista: ReportView };

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
  anyPerm?: readonly TeamPerm[];
};

export type AppRedirect = {
  to: "/" | "/funciones" | "/administrar" | "/configuracion";
  search?: NavSearch;
  hash?: string;
};

type PathGate = {
  prefix: string;
  roles: readonly NavRole[];
  perm?: TeamPerm;
  anyPerm?: readonly TeamPerm[];
};

const FUNCTION_PERMS = ["campanas", "vault"] as const satisfies readonly TeamPerm[];

export const NAV_LINKS: NavLink[] = [
  { id: "dashboard", label: "Dashboard", hint: "Métricas e informes", to: "/", roles: ALL_NAV_ROLES },
  { id: "operativa", label: "Operativa", hint: "Página real de OnlyFans", to: "/notificaciones", roles: OWNER_ROLES },
  { id: "chat", label: "Chat", hint: "Conversaciones en curso", to: "/mensajes", roles: ALL_NAV_ROLES, perm: "mensajes" },
  {
    id: "funciones-inteligentes",
    label: "Funciones inteligentes",
    hint: "Masivos, listas, bóveda y guiones",
    to: "/funciones",
    roles: STAFF_ROLES,
    anyPerm: FUNCTION_PERMS,
  },
  { id: "administrar", label: "Administrar", hint: "Creadoras y chatters", to: "/administrar", roles: AGENCY_ROLES, perm: "equipo" },
  { id: "proxys", label: "Proxys", hint: "IP de cada cuenta", to: "/proxys", roles: AGENCY_ROLES, perm: "equipo" },
  { id: "configuracion", label: "Configuración", hint: "Plan, facturación y ajustes", to: "/configuracion", roles: AGENCY_ROLES },
];

const LEGACY_GATED_PATHS: PathGate[] = [
  { prefix: "/creadoras", roles: AGENCY_ROLES, perm: "equipo" },
  { prefix: "/equipo", roles: AGENCY_ROLES, perm: "equipo" },
  { prefix: "/conectar", roles: AGENCY_ROLES, perm: "equipo" },
  { prefix: "/analitica", roles: ALL_NAV_ROLES, perm: "analitica" },
  { prefix: "/auditoria", roles: AGENCY_ROLES, perm: "analitica" },
  { prefix: "/campanas", roles: STAFF_ROLES, perm: "campanas" },
  { prefix: "/listas", roles: STAFF_ROLES, perm: "campanas" },
  { prefix: "/automatizaciones", roles: STAFF_ROLES, perm: "campanas" },
  { prefix: "/guiones", roles: STAFF_ROLES, perm: "campanas" },
  { prefix: "/enlaces", roles: STAFF_ROLES, perm: "campanas" },
  { prefix: "/vault", roles: STAFF_ROLES, perm: "vault" },
  { prefix: "/ajustes", roles: AGENCY_ROLES },
  { prefix: "/proximamente/facturacion", roles: AGENCY_ROLES },
  { prefix: "/proximamente/promocion-perfil", roles: STAFF_ROLES, perm: "campanas" },
  { prefix: "/proximamente/enlaces-prueba", roles: STAFF_ROLES, perm: "campanas" },
];

/**
 * La sesión solo guarda `owner` o `member`. El miembro entra como chatter.
 * `manager` (admin) existe en la tabla del menú y vería Configuración, pero esta función no lo devuelve.
 */
export function navRoleFromAccess(access: Pick<TeamAccess, "role"> | null | undefined): NavRole | null {
  if (!access) return null;
  if (access.role === "owner") return "owner";
  return "chatter";
}

export function allNavLinks(): NavLink[] {
  return NAV_LINKS;
}

export function isNavLinkVisible(item: NavLink, role: NavRole | null, access: TeamAccess | null): boolean {
  if (!role || !item.roles.includes(role)) return false;
  if (item.anyPerm && !item.anyPerm.some((perm) => hasPerm(access, perm))) return false;
  if (item.perm && !hasPerm(access, item.perm)) return false;
  return true;
}

export function visibleNavBlocks(role: NavRole | null, access: TeamAccess | null): NavLink[] {
  return NAV_LINKS.filter((item) => isNavLinkVisible(item, role, access));
}

export function reportView(value: unknown): ReportView {
  switch (value) {
    case "creadoras":
    case "equipo":
    case "fans":
    case "mensajes":
      return value;
    default:
      return "creadoras";
  }
}

export function reportTabsFor(panelOk: boolean): ReportView[] {
  return REPORT_VIEWS.filter((item) => item !== "mensajes" || panelOk);
}

export type ReportBodyKind = "analytics" | "audit" | "denied";

/** Misma decisión que pinta ReportsPanel: el chatter no abre el panel de mensajes. */
export function reportBodyKind(vista: ReportView, panelOk: boolean): ReportBodyKind {
  switch (vista) {
    case "creadoras":
    case "equipo":
    case "fans":
      return "analytics";
    case "mensajes":
      return panelOk ? "audit" : "denied";
    default: {
      const exhaustive: never = vista;
      return exhaustive;
    }
  }
}

export function reportHash(vista: ReportView): string {
  switch (vista) {
    case "creadoras":
      return "informes";
    case "equipo":
      return "informes-equipo";
    case "fans":
      return "informes-fans";
    case "mensajes":
      return "informes-mensajes";
    default: {
      const exhaustive: never = vista;
      return exhaustive;
    }
  }
}

export function dashboardZone(hash: string): DashboardZone {
  const id = hash.replace(/^#/, "").trim();
  switch (id) {
    case "informes":
    case "informes-creadoras":
      return { kind: "informes", vista: "creadoras" };
    case "informes-equipo":
      return { kind: "informes", vista: "equipo" };
    case "informes-fans":
      return { kind: "informes", vista: "fans" };
    case "informes-mensajes":
      return { kind: "informes", vista: "mensajes" };
    default:
      return { kind: "metricas", screen: parseScreen(id) };
  }
}

export function functionTab(value: unknown): FunctionTabId {
  const found = FUNCTION_TABS.find((tab) => tab.id === value);
  return found?.id ?? "masivos";
}

export function visibleFunctionTabs(role: NavRole | null, access: TeamAccess | null): FunctionTabId[] {
  if (!role || !includesRole(STAFF_ROLES, role)) return [];
  return FUNCTION_TABS.filter((tab) => hasPerm(access, tab.perm)).map((tab) => tab.id);
}

export function adminTab(value: unknown): AdminTab {
  if (value === "chatters" || value === "equipos") return "chatters";
  return "creadoras";
}

export function canOpenReports(role: NavRole | null, access: TeamAccess | null): boolean {
  if (!role) return false;
  return hasPerm(access, "analitica");
}

export function canOpenMessagePanel(role: NavRole | null, access: TeamAccess | null): boolean {
  if (!role || !includesRole(AGENCY_ROLES, role)) return false;
  return hasPerm(access, "analitica");
}

export function legacyRedirect(pathname: string, search: Record<string, unknown> = {}): AppRedirect | null {
  switch (pathname) {
    case "/analitica":
      return { to: "/", hash: reportHash(reportView(search.vista)) };
    case "/auditoria":
      return { to: "/", hash: reportHash("mensajes") };
    case "/ajustes":
      return { to: "/configuracion", hash: "ajustes" };
    case "/creadoras":
      return { to: "/administrar", search: { tab: "creadoras" } };
    case "/equipo":
      return { to: "/administrar", search: { tab: "chatters" } };
    case "/campanas":
      return { to: "/funciones", search: { tab: "masivos" } };
    case "/listas":
      return { to: "/funciones", search: { tab: "listas" } };
    case "/automatizaciones":
      return { to: "/funciones", search: { tab: "auto-seguir" } };
    case "/vault":
      return { to: "/funciones", search: { tab: "vault" } };
    case "/guiones":
      return { to: "/funciones", search: { tab: "guiones" } };
    case "/enlaces":
      return { to: "/funciones", search: { tab: "enlaces" } };
    case "/proximamente/facturacion":
      return { to: "/configuracion", hash: "facturacion" };
    case "/proximamente/promocion-perfil":
      return { to: "/funciones", search: { tab: "promocion" } };
    case "/proximamente/enlaces-prueba":
      return { to: "/funciones", search: { tab: "prueba" } };
    default:
      return null;
  }
}

function includesRole(roles: readonly NavRole[], role: NavRole): boolean {
  return roles.includes(role);
}

export function navPathOf(item: NavLink): string {
  return item.to;
}

export function pathMatchesNavLink(pathname: string, item: NavLink): boolean {
  if (item.to === "/") return pathname === "/";
  return pathname === item.to || pathname.startsWith(`${item.to}/`);
}

export function canAccessPath(pathname: string, role: NavRole | null, access: TeamAccess | null): boolean {
  if (!role) return false;
  const matches = allNavLinks().filter((item) => pathMatchesNavLink(pathname, item));
  if (matches.length > 0) return matches.some((item) => isNavLinkVisible(item, role, access));
  const legacy = LEGACY_GATED_PATHS.filter((item) => pathname === item.prefix || pathname.startsWith(`${item.prefix}/`)).sort(
    (left, right) => right.prefix.length - left.prefix.length,
  )[0];
  if (!legacy) return true;
  if (!legacy.roles.includes(role)) return false;
  if (legacy.anyPerm && !legacy.anyPerm.some((perm) => hasPerm(access, perm))) return false;
  if (legacy.perm && !hasPerm(access, legacy.perm)) return false;
  return true;
}
