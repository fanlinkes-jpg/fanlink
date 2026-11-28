import { createHash, randomBytes, randomUUID } from "node:crypto";
import { WorkspaceAccessError, type TeamAccess } from "./access-policy.ts";
import {
  INVITED_DEFAULT_PERMS,
  readInvitableLevel,
  readStaffLevel,
  type EmployeeRow,
  type InvitableLevel,
} from "./staff-levels.ts";
import type { SqlQuery } from "./workspace-store.ts";

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 128;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const CREATOR_ID_RE = /^[A-Za-z0-9_-]{1,80}$/;

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export function normalizeEmail(value: string): string | null {
  const email = value.trim().toLowerCase();
  return email.length <= 254 && EMAIL_RE.test(email) ? email : null;
}

function cleanName(value: string): string | null {
  const name = value.replace(/\s+/g, " ").trim();
  return name && name.length <= 80 ? name : null;
}

function cleanCreatorIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const ids = value.filter((id): id is string => typeof id === "string" && CREATOR_ID_RE.test(id));
  return [...new Set(ids)];
}

export type InviteInput = {
  name: string;
  email: string;
  level: string;
  creatorIds: string[];
};

type InviteRow = {
  id: string;
  name: string;
  email: string;
  level: string;
  perms: unknown;
  creator_ids: unknown;
  created_by: string;
  expires_at: Date | string;
  used_at: Date | string | null;
  revoked_at: Date | string | null;
};

export type Invite = {
  id: string;
  name: string;
  email: string;
  level: InvitableLevel;
  perms: string[];
  creatorIds: string[];
  createdBy: string;
  expiresAt: string;
};

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function asList(value: unknown): string[] {
  const parsed = typeof value === "string" ? safeJson(value) : value;
  return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function toInvite(row: InviteRow): Invite {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    level: readInvitableLevel(row.level) ?? "chatter",
    perms: asList(row.perms),
    creatorIds: asList(row.creator_ids),
    createdBy: row.created_by,
    expiresAt: iso(row.expires_at),
  };
}

function requireOwner(actor: TeamAccess): void {
  if (actor.role !== "owner") throw new WorkspaceAccessError("Solo la dueña puede gestionar empleados.");
}

function validate(input: InviteInput): { name: string; email: string; level: InvitableLevel; creatorIds: string[] } {
  const name = cleanName(input.name);
  if (!name) throw new WorkspaceAccessError("Escribe el nombre del empleado (hasta 80 caracteres).");
  const email = normalizeEmail(input.email);
  if (!email) throw new WorkspaceAccessError("El correo no es válido.");
  const level = readInvitableLevel(input.level);
  if (!level) throw new WorkspaceAccessError("Elige un rol válido. El rol Owner no se puede asignar.");
  return { name, email, level, creatorIds: cleanCreatorIds(input.creatorIds) };
}

async function emailTaken(sql: SqlQuery, email: string): Promise<boolean> {
  const rows = await sql.query(
    `select 1 from staff_profile where lower(email) = $1
     union all select 1 from "user" where lower("email") = $1`,
    [email],
  );
  return rows.length > 0;
}

/** Crea una invitación nueva. Sustituye a otra abierta para el mismo correo. El token solo se devuelve aquí. */
export async function createInvite(
  sql: SqlQuery,
  actor: TeamAccess,
  input: InviteInput,
  now: Date = new Date(),
): Promise<{ id: string; token: string; expiresAt: string }> {
  requireOwner(actor);
  const clean = validate(input);
  if (await emailTaken(sql, clean.email)) {
    throw new WorkspaceAccessError("Ya hay un empleado con ese correo.");
  }
  await sql.query(
    "update staff_invite set revoked_at = $2 where lower(email) = $1 and used_at is null and revoked_at is null",
    [clean.email, now.toISOString()],
  );
  const id = randomUUID();
  const token = newToken();
  const expiresAt = new Date(now.getTime() + INVITE_TTL_MS).toISOString();
  await sql.query(
    `insert into staff_invite (id, token_hash, name, email, level, perms, creator_ids, created_by, created_at, expires_at)
     values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10)`,
    [
      id,
      hashToken(token),
      clean.name,
      clean.email,
      clean.level,
      JSON.stringify(INVITED_DEFAULT_PERMS),
      JSON.stringify(clean.creatorIds),
      actor.userId,
      now.toISOString(),
      expiresAt,
    ],
  );
  return { id, token, expiresAt };
}

/** Reenviar: el token anterior deja de valer y empieza una caducidad de 7 días nueva. */
export async function renewInvite(
  sql: SqlQuery,
  actor: TeamAccess,
  inviteId: string,
  now: Date = new Date(),
): Promise<{ id: string; token: string; expiresAt: string; email: string; name: string }> {
  requireOwner(actor);
  const token = newToken();
  const expiresAt = new Date(now.getTime() + INVITE_TTL_MS).toISOString();
  const rows = await sql.query<{ email: string; name: string }>(
    `update staff_invite set token_hash = $2, expires_at = $3, created_at = $4
     where id = $1 and used_at is null and revoked_at is null
     returning email, name`,
    [inviteId, hashToken(token), expiresAt, now.toISOString()],
  );
  if (!rows[0]) throw new WorkspaceAccessError("Esa invitación ya no está pendiente.");
  return { id: inviteId, token, expiresAt, email: rows[0].email, name: rows[0].name };
}

export type InviteState = "ok" | "invalid" | "expired" | "used" | "revoked";

async function readByToken(sql: SqlQuery, token: string): Promise<InviteRow | null> {
  if (!token || token.length > 200) return null;
  const rows = await sql.query<InviteRow>(
    `select id, name, email, level, perms, creator_ids, created_by, expires_at, used_at, revoked_at
     from staff_invite where token_hash = $1`,
    [hashToken(token)],
  );
  return rows[0] ?? null;
}

function stateOf(row: InviteRow, now: Date): InviteState {
  if (row.used_at) return "used";
  if (row.revoked_at) return "revoked";
  if (new Date(row.expires_at).getTime() <= now.getTime()) return "expired";
  return "ok";
}

export async function inspectInvite(
  sql: SqlQuery,
  token: string,
  now: Date = new Date(),
): Promise<{ state: InviteState; name?: string; email?: string }> {
  const row = await readByToken(sql, token);
  if (!row) return { state: "invalid" };
  const state = stateOf(row, now);
  return state === "ok" ? { state, name: row.name, email: row.email } : { state };
}

/** Consume el token de forma atómica: solo una petición puede llevárselo. */
export async function claimInvite(
  sql: SqlQuery,
  token: string,
  now: Date = new Date(),
): Promise<{ ok: true; invite: Invite } | { ok: false; state: Exclude<InviteState, "ok"> }> {
  if (token && token.length <= 200) {
    const claimed = await sql.query<InviteRow>(
      `update staff_invite set used_at = $2
       where token_hash = $1 and used_at is null and revoked_at is null and expires_at > $2
       returning id, name, email, level, perms, creator_ids, created_by, expires_at, used_at, revoked_at`,
      [hashToken(token), now.toISOString()],
    );
    if (claimed[0]) return { ok: true, invite: toInvite(claimed[0]) };
  }
  const state = (await inspectInvite(sql, token, now)).state;
  return { ok: false, state: state === "ok" ? "used" : state };
}

/** Si algo falla después de reclamar el token, se libera para poder reintentar. */
export async function releaseInvite(sql: SqlQuery, inviteId: string): Promise<void> {
  await sql.query("update staff_invite set used_at = null, used_by = null where id = $1", [inviteId]);
}

/** Crea la ficha del empleado con el nivel, los permisos y las creadoras de la invitación. */
export async function activateInvitedStaff(sql: SqlQuery, invite: Invite, userId: string): Promise<void> {
  await sql.query("insert into workspace_member (user_id) values ($1) on conflict (user_id) do nothing", [userId]);
  await sql.query(
    `insert into staff_profile (user_id, display_name, role, perms, level, status, email)
     values ($1, $2, 'member', $3::jsonb, $4, 'active', $5)
     on conflict (user_id) do update set
       display_name = excluded.display_name, perms = excluded.perms, level = excluded.level,
       status = 'active', disabled_at = null, email = excluded.email
     where staff_profile.role = 'member'`,
    [userId, invite.name, JSON.stringify(invite.perms), invite.level, invite.email],
  );
  for (const creatorId of invite.creatorIds) {
    await sql.query(
      "insert into creator_grant (user_id, creator_id) values ($1, $2) on conflict (user_id, creator_id) do nothing",
      [userId, creatorId],
    );
  }
  await sql.query("update staff_invite set used_by = $2 where id = $1", [invite.id, userId]);
}

type ProfileListRow = {
  user_id: string;
  display_name: string;
  role: string;
  level: string;
  status: string;
  email: string | null;
  auth_email: string | null;
};

export async function listEmployees(sql: SqlQuery, now: Date = new Date()): Promise<EmployeeRow[]> {
  const profiles = await sql.query<ProfileListRow>(
    `select p.user_id, p.display_name, p.role, p.level, p.status, p.email, u."email" as auth_email
     from staff_profile p left join "user" u on u."id" = p.user_id
     order by p.created_at, p.user_id`,
  );
  const grants = await sql.query<{ user_id: string; creator_id: string }>(
    "select user_id, creator_id from creator_grant order by creator_id",
  );
  const invites = await sql.query<InviteRow>(
    `select id, name, email, level, perms, creator_ids, created_by, expires_at, used_at, revoked_at
     from staff_invite where used_at is null and revoked_at is null order by created_at, id`,
  );
  const members: EmployeeRow[] = profiles.map((row) => ({
    id: row.user_id,
    kind: "member",
    name: row.display_name,
    email: row.email ?? row.auth_email,
    level: row.role === "owner" ? "owner" : readStaffLevel(row.level),
    status: row.status === "disabled" ? "disabled" : "active",
    creatorIds: grants.filter((grant) => grant.user_id === row.user_id).map((grant) => grant.creator_id),
    expiresAt: null,
    expired: false,
  }));
  const pending: EmployeeRow[] = invites.map((row) => {
    const invite = toInvite(row);
    return {
      id: invite.id,
      kind: "invite",
      name: invite.name,
      email: invite.email,
      level: invite.level,
      status: "invited",
      creatorIds: invite.creatorIds,
      expiresAt: invite.expiresAt,
      expired: stateOf(row, now) === "expired",
    };
  });
  return [...members, ...pending];
}

export type EmployeeEdit = { name: string; level: string; creatorIds: string[] };

async function memberOf(sql: SqlQuery, userId: string): Promise<{ role: string; status: string } | null> {
  const rows = await sql.query<{ role: string; status: string }>(
    "select role, status from staff_profile where user_id = $1",
    [userId],
  );
  return rows[0] ?? null;
}

async function editableMember(sql: SqlQuery, actor: TeamAccess, userId: string): Promise<{ role: string; status: string }> {
  requireOwner(actor);
  const member = await memberOf(sql, userId);
  if (!member) throw new WorkspaceAccessError("No hay ficha para esa persona.");
  if (member.role === "owner") throw new WorkspaceAccessError("La dueña no se edita desde aquí.");
  return member;
}

export async function editEmployee(sql: SqlQuery, actor: TeamAccess, id: string, kind: "member" | "invite", input: EmployeeEdit): Promise<void> {
  requireOwner(actor);
  const name = cleanName(input.name);
  if (!name) throw new WorkspaceAccessError("Escribe el nombre del empleado (hasta 80 caracteres).");
  const level = readInvitableLevel(input.level);
  if (!level) throw new WorkspaceAccessError("Elige un rol válido. El rol Owner no se puede asignar.");
  const creatorIds = cleanCreatorIds(input.creatorIds);
  if (kind === "invite") {
    const updated = await sql.query(
      `update staff_invite set name = $2, level = $3, creator_ids = $4::jsonb
       where id = $1 and used_at is null and revoked_at is null returning id`,
      [id, name, level, JSON.stringify(creatorIds)],
    );
    if (!updated[0]) throw new WorkspaceAccessError("Esa invitación ya no está pendiente.");
    return;
  }
  await editableMember(sql, actor, id);
  await sql.query("update staff_profile set display_name = $2, level = $3 where user_id = $1", [id, name, level]);
  const current = await sql.query<{ creator_id: string }>("select creator_id from creator_grant where user_id = $1", [id]);
  const have = new Set(current.map((row) => row.creator_id));
  const want = new Set(creatorIds);
  for (const creatorId of want) {
    if (!have.has(creatorId)) {
      await sql.query("insert into creator_grant (user_id, creator_id) values ($1, $2) on conflict (user_id, creator_id) do nothing", [id, creatorId]);
    }
  }
  for (const creatorId of have) {
    if (!want.has(creatorId)) await sql.query("delete from creator_grant where user_id = $1 and creator_id = $2", [id, creatorId]);
  }
}

/** Desactivar corta el acceso al momento. Las sesiones se borran para que no entre con una cookie vieja. */
export async function setEmployeeActive(sql: SqlQuery, actor: TeamAccess, userId: string, active: boolean): Promise<void> {
  await editableMember(sql, actor, userId);
  if (active) {
    await sql.query("update staff_profile set status = 'active', disabled_at = null where user_id = $1", [userId]);
    return;
  }
  await sql.query("update staff_profile set status = 'disabled', disabled_at = now() where user_id = $1", [userId]);
  await sql.query(`delete from "session" where "userId" = $1`, [userId]);
}

/**
 * Borra a la persona. Sus envíos se quedan: la clave foránea de of_chat_outbound pasa a null
 * y el nombre queda guardado en author_name.
 */
export async function deleteEmployee(sql: SqlQuery, actor: TeamAccess, id: string, kind: "member" | "invite"): Promise<void> {
  requireOwner(actor);
  if (kind === "invite") {
    await sql.query(
      "update staff_invite set revoked_at = now() where id = $1 and used_at is null and revoked_at is null",
      [id],
    );
    return;
  }
  if (id === actor.userId) throw new WorkspaceAccessError("No puedes borrarte a ti misma.");
  await editableMember(sql, actor, id);
  await sql.query("delete from creator_grant where user_id = $1", [id]);
  await sql.query("delete from staff_alert where user_id = $1", [id]);
  await sql.query("delete from staff_profile where user_id = $1", [id]);
  await sql.query("delete from workspace_member where user_id = $1", [id]);
  await sql.query(`delete from "user" where "id" = $1`, [id]);
}

/** Lo que hace falta antes de dejar entrar: la ficha existe y no está desactivada. */
export async function isStaffDisabled(sql: SqlQuery, userId: string): Promise<boolean> {
  const rows = await sql.query<{ status: string }>("select status from staff_profile where user_id = $1", [userId]);
  return rows[0]?.status === "disabled";
}

export function validatePassword(password: unknown): string {
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    throw new WorkspaceAccessError(`La contraseña necesita al menos ${MIN_PASSWORD_LENGTH} caracteres.`);
  }
  if (password.length > MAX_PASSWORD_LENGTH) throw new WorkspaceAccessError("La contraseña es demasiado larga.");
  return password;
}
