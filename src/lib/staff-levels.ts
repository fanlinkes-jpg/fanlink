/** Roles de empleado. Un empleado puede tener varios; los permisos de cada rol vienen de staff-roles.ts y se suman. */
export const INVITABLE_LEVELS = ["chatter", "account_manager", "team_manager", "supervisor", "analyst", "admin"] as const;
export const STAFF_LEVELS = ["owner", ...INVITABLE_LEVELS] as const;

export type InvitableLevel = (typeof INVITABLE_LEVELS)[number];
export type StaffLevel = (typeof STAFF_LEVELS)[number];

export const LEVEL_LABELS: Record<StaffLevel, string> = {
  owner: "Owner",
  chatter: "Chatter",
  account_manager: "Account Manager",
  team_manager: "Team Manager",
  supervisor: "Supervisor",
  analyst: "Analyst",
  admin: "Admin",
};

export function readInvitableLevel(value: unknown): InvitableLevel | null {
  return INVITABLE_LEVELS.find((level) => level === value) ?? null;
}

export function readStaffLevel(value: unknown): StaffLevel {
  return STAFF_LEVELS.find((level) => level === value) ?? "chatter";
}

/** Lista de roles de un valor suelto (JSON ya leído). Sin roles válidos, cae al nivel principal. */
export function readRoles(value: unknown, fallback: StaffLevel): StaffLevel[] {
  const parsed = typeof value === "string" ? safeParse(value) : value;
  const list = Array.isArray(parsed) ? parsed : [];
  const roles = STAFF_LEVELS.filter((level) => list.includes(level));
  return roles.length > 0 ? roles : [fallback];
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export type EmployeeStatus = "active" | "disabled" | "invited";

export type EmployeeRow = {
  /** user_id de la ficha, o id de la invitación si todavía no ha aceptado. */
  id: string;
  kind: "member" | "invite";
  name: string;
  email: string | null;
  /** Rol principal: el primero de `roles`. */
  level: StaffLevel;
  /** Todos los roles. Los permisos de cada uno se suman. */
  roles: StaffLevel[];
  status: EmployeeStatus;
  creatorIds: string[];
  /** Casillas de permisos. En una invitación, los que tendrá al aceptar. */
  perms: string[];
  /** Avisos por teléfono. Solo fichas; una invitación aún no tiene. */
  phone: string | null;
  alertsEnabled: boolean;
  quietMinutes: number;
  /** Última vez que la persona usó el CRM (ISO). Null si nunca entró. */
  lastSeenAt: string | null;
  /** Solo invitaciones: ISO de caducidad. */
  expiresAt: string | null;
  expired: boolean;
};

/** «Ahora», «hace 5 min», «hace 3 h», «hace 2 d» o la fecha. Sin dato: «Nunca». */
export function lastSeenLabel(iso: string | null, now: Date = new Date()): string {
  if (!iso) return "Nunca";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "Nunca";
  const minutes = Math.max(0, Math.floor((now.getTime() - then) / 60_000));
  if (minutes < 2) return "Ahora";
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `hace ${days} d`;
  return new Date(iso).toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" });
}
