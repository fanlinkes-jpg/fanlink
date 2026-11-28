import {
  assertWorkspaceChange,
  emptyWorkspace,
  mergeScopedWorkspace,
  scopeWorkspaceFor,
  TEAM_PERMS,
  type TeamAccess,
  type TeamPerm,
  type TeamRole,
  type WorkspaceSlice,
  WorkspaceAccessError,
} from "./access-policy.ts";
import { readRoles, readStaffLevel, type StaffLevel } from "./staff-levels.ts";
import { restrictPerms } from "./staff-roles.ts";

export interface SqlQuery {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
}

export type SaveResult =
  | { ok: true; version: number }
  | { ok: false; reason: "conflict"; version: number; state: WorkspaceSlice | null; updatedBy: string | null }
  | { ok: false; reason: "forbidden"; message: string };

type ProfileRow = {
  user_id: string;
  display_name: string;
  role: string;
  perms: unknown;
  level?: string | null;
  roles?: unknown;
  status?: string | null;
};

export type StaffAccess = TeamAccess & {
  displayName: string;
  devMode: boolean;
  level: StaffLevel;
  /** Todos los roles. Los permisos ya vienen sumados en `perms`. */
  roles: StaffLevel[];
  /** disabled: la ficha existe pero no ve nada. */
  status: "active" | "disabled";
};

type GrantRow = { creator_id: string };
type StateRow = { state: unknown; version: number | string; updated_by: string | null };

const PLACEHOLDER_NAMES = ["Operador local", "Miembro"];

export function cleanDisplayName(value: string): string | null {
  const name = value.replace(/\s+/g, " ").trim();
  if (!name || name.length > 80) return null;
  return name;
}

export async function ensureStaff(sql: SqlQuery, userId: string, devMode: boolean): Promise<StaffAccess> {
  await sql.query("insert into workspace_member (user_id) values ($1) on conflict (user_id) do nothing", [userId]);
  const existing = await sql.query<ProfileRow>("select user_id from staff_profile where user_id = $1", [userId]);
  if (!existing[0]) {
    const owners = await sql.query("select user_id from staff_profile where role = 'owner' limit 1");
    const role: TeamRole = owners.length === 0 ? "owner" : "member";
    const perms = role === "owner" ? [...TEAM_PERMS] : [];
    const displayName = "Miembro";
    await sql.query(
      "insert into staff_profile (user_id, display_name, role, perms, level) values ($1, $2, $3, $4::jsonb, $5)",
      [userId, displayName, role, JSON.stringify(perms), role === "owner" ? "owner" : "chatter"],
    );
  }
  // Última conexión: como mucho una escritura por minuto y persona.
  await sql.query(
    "update staff_profile set last_seen_at = now() where user_id = $1 and (last_seen_at is null or last_seen_at < now() - interval '1 minute')",
    [userId],
  );
  // Revisa retrasos de turno como mucho una vez por minuto, sin bloquear la entrada.
  void import("./staff-shifts-store.ts").then((mod) => mod.scanLateShiftsSoon(sql));
  return readAccess(sql, userId, devMode);
}

export async function readAccess(sql: SqlQuery, userId: string, devMode: boolean): Promise<StaffAccess> {
  const profiles = await sql.query<ProfileRow>("select user_id, display_name, role, perms, level, roles, status from staff_profile where user_id = $1", [userId]);
  const profile = profiles[0];
  if (!profile) {
    return { userId, role: "member", perms: [], creatorIds: [], displayName: "Miembro", devMode, level: "chatter", roles: ["chatter"], status: "active" };
  }
  const level = profile.role === "owner" ? "owner" : readStaffLevel(profile.level);
  const roles = profile.role === "owner" ? (["owner"] as StaffLevel[]) : readRoles(profile.roles, level);
  if (profile.status === "disabled" && profile.role !== "owner") {
    return { userId, role: "member", perms: [], creatorIds: [], displayName: profile.display_name, devMode, level, roles, status: "disabled" };
  }
  const grants = await sql.query<GrantRow>("select creator_id from creator_grant where user_id = $1 order by creator_id", [userId]);
  const isOwner = profile.role === "owner";
  // Un chatter nunca recibe dinero de agencia, aunque la ficha lo traiga marcado: se quita al leer.
  const perms = isOwner ? readPerms(profile.perms) : restrictPerms(roles, readPerms(profile.perms));
  const creatorIds = grants.map((row) => row.creator_id);
  if (!isOwner && perms.includes("todas")) {
    for (const id of await everyCreatorId(sql)) if (!creatorIds.includes(id)) creatorIds.push(id);
    creatorIds.sort();
  }
  return {
    userId,
    role: isOwner ? "owner" : "member",
    perms,
    creatorIds,
    displayName: profile.display_name,
    devMode,
    level,
    roles,
    status: "active",
  };
}

/** Toda cuenta que el espacio conoce: sesiones guardadas y creadoras del espacio compartido. */
async function everyCreatorId(sql: SqlQuery): Promise<string[]> {
  const ids = new Set<string>();
  try {
    for (const row of await sql.query<{ creator_id: string }>("select creator_id from of_session_account")) {
      if (row.creator_id?.trim()) ids.add(row.creator_id);
    }
  } catch {
    // Sin tabla de sesiones no hay cuentas que sumar.
  }
  try {
    const state = await sql.query<{ state: unknown }>("select state from workspace_state where id = 1");
    const slice = parseSlice(state[0]?.state ?? null);
    for (const creator of slice?.creators ?? []) if (creator?.id) ids.add(creator.id);
  } catch {
    // Sin estado compartido tampoco.
  }
  return [...ids];
}

export type StaffAlert = {
  phone: string | null;
  alertsEnabled: boolean;
  quietMinutes: number;
};

export async function listStaff(sql: SqlQuery): Promise<Array<TeamAccess & { displayName: string } & StaffAlert>> {
  const profiles = await sql.query<ProfileRow>("select user_id, display_name, role, perms from staff_profile order by created_at, user_id");
  const grants = await sql.query<GrantRow & { user_id: string }>("select user_id, creator_id from creator_grant");
  const alerts = await sql.query<{ user_id: string; phone: string | null; alerts_enabled: boolean | string; quiet_minutes: number | string | null }>(
    "select user_id, phone, alerts_enabled, quiet_minutes from staff_alert",
  );
  return profiles.map((profile) => {
    const alert = alerts.find((row) => row.user_id === profile.user_id);
    return {
      userId: profile.user_id,
      role: profile.role === "owner" ? "owner" : "member",
      perms: readPerms(profile.perms),
      creatorIds: grants.filter((grant) => grant.user_id === profile.user_id).map((grant) => grant.creator_id),
      displayName: profile.display_name,
      phone: alert?.phone ?? null,
      alertsEnabled: alert?.alerts_enabled === true || alert?.alerts_enabled === "t" || alert?.alerts_enabled === "true",
      quietMinutes: Number(alert?.quiet_minutes ?? 15) || 15,
    };
  });
}

export async function setStaffAlert(
  sql: SqlQuery,
  actor: TeamAccess,
  userId: string,
  input: { phone: string; enabled: boolean; quietMinutes: number },
): Promise<void> {
  if (actor.role !== "owner" && actor.userId !== userId) {
    throw new WorkspaceAccessError("Solo puedes cambiar tu propio aviso.");
  }
  const phone = input.phone.trim();
  if (phone && !/^\+[1-9]\d{7,14}$/.test(phone.replace(/[\s()-]/g, ""))) {
    throw new WorkspaceAccessError("El teléfono tiene que ir en formato internacional, por ejemplo +34600000000.");
  }
  const quiet = Math.min(1440, Math.max(1, Math.round(input.quietMinutes) || 15));
  const normalized = phone ? phone.replace(/[\s()-]/g, "") : null;
  await sql.query(
    `insert into staff_alert (user_id, phone, alerts_enabled, quiet_minutes)
     values ($1, $2, $3, $4)
     on conflict (user_id) do update set
       phone = excluded.phone,
       alerts_enabled = excluded.alerts_enabled,
       quiet_minutes = excluded.quiet_minutes`,
    [userId, normalized, input.enabled, quiet],
  );
}

/** El nombre de la sesión sustituye al placeholder. Un nombre ya elegido no se pisa. */
export async function adoptStaffName(sql: SqlQuery, userId: string, name: string): Promise<string | null> {
  const clean = cleanDisplayName(name);
  if (!clean || PLACEHOLDER_NAMES.includes(clean)) return null;
  const slots = PLACEHOLDER_NAMES.map((_, index) => `$${index + 3}`).join(", ");
  const updated = await sql.query<{ display_name: string }>(
    `update staff_profile set display_name = $2
     where user_id = $1 and display_name in (${slots})
     returning display_name`,
    [userId, clean, ...PLACEHOLDER_NAMES],
  );
  return updated[0]?.display_name ?? null;
}

/** El chatter elige cómo se ve su nombre junto a la hora del mensaje. */
export async function setOwnDisplayName(sql: SqlQuery, userId: string, name: string): Promise<string> {
  const clean = cleanDisplayName(name);
  if (!clean) throw new WorkspaceAccessError("Escribe un nombre de hasta 80 caracteres.");
  const updated = await sql.query<{ display_name: string }>(
    "update staff_profile set display_name = $2 where user_id = $1 returning display_name",
    [userId, clean],
  );
  const saved = updated[0]?.display_name;
  if (!saved) throw new WorkspaceAccessError("No hay ficha para ese usuario.");
  return saved;
}

export async function setStaffPerms(sql: SqlQuery, actor: TeamAccess, userId: string, perms: string[]): Promise<void> {
  if (actor.role !== "owner") throw new WorkspaceAccessError("Solo la dueña puede cambiar permisos.");
  const clean = TEAM_PERMS.filter((perm) => perms.includes(perm));
  const updated = await sql.query("update staff_profile set perms = $2::jsonb where user_id = $1 and role = 'member' returning user_id", [
    userId,
    JSON.stringify(clean),
  ]);
  if (!updated[0]) throw new WorkspaceAccessError("Esa persona no es un miembro editable.");
}

export async function setCreatorGrant(sql: SqlQuery, actor: TeamAccess, userId: string, creatorId: string, granted: boolean): Promise<void> {
  if (actor.role !== "owner") throw new WorkspaceAccessError("Solo la dueña puede asignar creadoras.");
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(creatorId)) throw new WorkspaceAccessError("La creadora no es válida.");
  if (granted) {
    await sql.query(
      "insert into creator_grant (user_id, creator_id) values ($1, $2) on conflict (user_id, creator_id) do nothing",
      [userId, creatorId],
    );
    return;
  }
  await sql.query("delete from creator_grant where user_id = $1 and creator_id = $2", [userId, creatorId]);
}

export async function commitWorkspace(
  sql: SqlQuery,
  userId: string,
  expectedVersion: number,
  next: WorkspaceSlice,
  access: TeamAccess,
): Promise<SaveResult> {
  const current = await readState(sql);
  if (current.version !== expectedVersion) {
    return { ok: false, reason: "conflict", version: current.version, state: scopedState(access, current.state), updatedBy: current.updatedBy };
  }
  const prior = current.state ?? emptyWorkspace();
  const merged = mergeScopedWorkspace(access, prior, next);
  try {
    assertWorkspaceChange(access, prior, merged);
  } catch (error) {
    if (error instanceof WorkspaceAccessError) return { ok: false, reason: "forbidden", message: error.message };
    throw error;
  }
  if (current.version === 0) {
    const inserted = await sql.query<{ version: number }>(
      `insert into workspace_state (id, state, version, updated_by)
       values (1, $1::jsonb, 1, $2)
       on conflict (id) do nothing
       returning version`,
      [JSON.stringify(merged), userId],
    );
    if (!inserted[0]) {
      const again = await readState(sql);
      return { ok: false, reason: "conflict", version: again.version, state: scopedState(access, again.state), updatedBy: again.updatedBy };
    }
    return { ok: true, version: Number(inserted[0].version) };
  }
  const updated = await sql.query<{ version: number }>(
    `update workspace_state
     set state = $1::jsonb, version = version + 1, updated_at = now(), updated_by = $2
     where id = 1 and version = $3
     returning version`,
    [JSON.stringify(merged), userId, expectedVersion],
  );
  if (!updated[0]) {
    const again = await readState(sql);
    return { ok: false, reason: "conflict", version: again.version, state: scopedState(access, again.state), updatedBy: again.updatedBy };
  }
  return { ok: true, version: Number(updated[0].version) };
}

/** El estado compartido tal como lo puede ver esta persona. */
export function scopedState(access: TeamAccess, state: WorkspaceSlice | null): WorkspaceSlice | null {
  return state ? scopeWorkspaceFor(access, state) : null;
}

async function readState(sql: SqlQuery): Promise<{ version: number; state: WorkspaceSlice | null; updatedBy: string | null }> {
  const rows = await sql.query<StateRow>("select state, version, updated_by from workspace_state where id = 1");
  const row = rows[0];
  if (!row) return { version: 0, state: null, updatedBy: null };
  return { version: Number(row.version), state: parseSlice(row.state), updatedBy: row.updated_by };
}

function parseSlice(value: unknown): WorkspaceSlice {
  if (value == null) return emptyWorkspace();
  if (typeof value === "string") return JSON.parse(value) as WorkspaceSlice;
  return value as WorkspaceSlice;
}

function readPerms(value: unknown): TeamPerm[] {
  const list = Array.isArray(value) ? value : typeof value === "string" ? (JSON.parse(value) as unknown[]) : [];
  return TEAM_PERMS.filter((perm) => list.includes(perm));
}
