/** Niveles de empleado. Por ahora solo marcan el nivel; la matriz de permisos por nivel va aparte. */
export const INVITABLE_LEVELS = ["chatter", "account_manager", "team_manager", "supervisor", "analyst"] as const;
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
};

export function readInvitableLevel(value: unknown): InvitableLevel | null {
  return INVITABLE_LEVELS.find((level) => level === value) ?? null;
}

export function readStaffLevel(value: unknown): StaffLevel {
  return STAFF_LEVELS.find((level) => level === value) ?? "chatter";
}

/** Permisos con los que entra cualquier nivel invitado hasta que exista la matriz por nivel. */
export const INVITED_DEFAULT_PERMS = ["mensajes"] as const;

export type EmployeeStatus = "active" | "disabled" | "invited";

export type EmployeeRow = {
  /** user_id de la ficha, o id de la invitación si todavía no ha aceptado. */
  id: string;
  kind: "member" | "invite";
  name: string;
  email: string | null;
  level: StaffLevel;
  status: EmployeeStatus;
  creatorIds: string[];
  /** Casillas de permisos. En una invitación, los que tendrá al aceptar. */
  perms: string[];
  /** Avisos por teléfono. Solo fichas; una invitación aún no tiene. */
  phone: string | null;
  alertsEnabled: boolean;
  quietMinutes: number;
  /** Solo invitaciones: ISO de caducidad. */
  expiresAt: string | null;
  expired: boolean;
};
