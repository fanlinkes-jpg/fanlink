import { hasPerm, WorkspaceAccessError, type TeamAccess } from "./access-policy.ts";
import type { SqlQuery } from "./workspace-store.ts";

export type AssignedEmployee = { id: string; name: string };

export type CreatorAssignment = {
  creatorId: string;
  employees: AssignedEmployee[];
};

export function canManageCreators(access: TeamAccess | null): boolean {
  return hasPerm(access, "equipo");
}

/** Invierte `creator_grant`: por cada creadora, las personas asignadas, con su nombre real. */
export function assignmentsFromGrants(
  grants: Array<{ user_id: string; creator_id: string }>,
  people: Array<{ user_id: string; display_name: string; status?: string | null }>,
): CreatorAssignment[] {
  const names = new Map<string, string>();
  for (const person of people) {
    if (person.status === "disabled") continue;
    names.set(person.user_id, person.display_name);
  }
  const byCreator = new Map<string, AssignedEmployee[]>();
  for (const grant of grants) {
    const name = names.get(grant.user_id);
    if (!name) continue;
    const list = byCreator.get(grant.creator_id) ?? [];
    if (!list.some((item) => item.id === grant.user_id)) list.push({ id: grant.user_id, name });
    byCreator.set(grant.creator_id, list);
  }
  for (const list of byCreator.values()) list.sort((left, right) => left.name.localeCompare(right.name, "es"));
  return [...byCreator.entries()].map(([creatorId, employees]) => ({ creatorId, employees }));
}

export function staffNamesFor(assignments: readonly CreatorAssignment[], creatorId: string): string[] {
  return assignments.find((item) => item.creatorId === creatorId)?.employees.map((item) => item.name) ?? [];
}

export async function listCreatorAssignments(sql: SqlQuery, actor: TeamAccess): Promise<CreatorAssignment[]> {
  if (!canManageCreators(actor)) throw new WorkspaceAccessError("No tienes permiso para ver las asignaciones.");
  const grants = await sql.query<{ user_id: string; creator_id: string }>("select user_id, creator_id from creator_grant");
  const people = await sql.query<{ user_id: string; display_name: string; status: string | null }>(
    "select user_id, display_name, status from staff_profile where role = 'member' or role = 'owner'",
  );
  return assignmentsFromGrants(grants, people);
}

export async function listAssignableStaff(sql: SqlQuery, actor: TeamAccess): Promise<AssignedEmployee[]> {
  if (!canManageCreators(actor)) throw new WorkspaceAccessError("No tienes permiso para ver el equipo.");
  const people = await sql.query<{ user_id: string; display_name: string }>(
    `select user_id, display_name from staff_profile
      where coalesce(status, 'active') = 'active' and role = 'member'
      order by lower(display_name), user_id`,
  );
  return people.map((row) => ({ id: row.user_id, name: row.display_name }));
}

/** Sincroniza `creator_grant` de una creadora: alta y baja en ambos sentidos con la ficha del empleado. */
export async function setCreatorAssignees(sql: SqlQuery, actor: TeamAccess, creatorId: string, userIds: string[]): Promise<CreatorAssignment[]> {
  if (!canManageCreators(actor)) throw new WorkspaceAccessError("No tienes permiso para asignar empleados.");
  const id = creatorId.trim();
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) throw new WorkspaceAccessError("La cuenta no es válida.");
  const unique = [...new Set(userIds.filter((userId) => typeof userId === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(userId)))];
  const current = await sql.query<{ user_id: string }>("select user_id from creator_grant where creator_id = $1", [id]);
  const want = new Set(unique);
  const have = new Set(current.map((row) => row.user_id));
  for (const userId of unique) {
    if (!have.has(userId)) {
      await sql.query(
        "insert into creator_grant (user_id, creator_id) values ($1, $2) on conflict (user_id, creator_id) do nothing",
        [userId, id],
      );
    }
  }
  for (const row of current) {
    if (!want.has(row.user_id)) await sql.query("delete from creator_grant where user_id = $1 and creator_id = $2", [row.user_id, id]);
  }
  return listCreatorAssignments(sql, actor);
}
