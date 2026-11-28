import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import type { EmployeeRow } from "@/lib/staff-levels";
import type { InviteDelivery } from "@/lib/employees-runtime.server";

export type { EmployeeRow, InviteDelivery };

/** El servidor decide: solo la dueña ve y gestiona empleados. */
export const listEmployees = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { staffContext } = await import("@/lib/employees-runtime.server");
    const { listEmployees: read } = await import("@/lib/staff-invite");
    const { sql, actor } = await staffContext(context.userId);
    if (actor.role !== "owner") return { rows: [] as EmployeeRow[], allowed: false as const };
    return { rows: await read(sql), allowed: true as const };
  });

export const inviteEmployee = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { name: string; email: string; level?: string; roles?: string[]; creatorIds: string[]; perms?: string[] }) => input)
  .handler(async ({ context, data }): Promise<InviteDelivery> => {
    const { staffContext, deliverInvite } = await import("@/lib/employees-runtime.server");
    const { createInvite, normalizeEmail } = await import("@/lib/staff-invite");
    const { sql, actor } = await staffContext(context.userId);
    const created = await createInvite(sql, actor, data);
    const agency = await readAgency(sql);
    return deliverInvite({
      ...created,
      name: data.name.trim(),
      email: normalizeEmail(data.email) ?? data.email,
      agency,
    });
  });

export const resendEmployeeInvite = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { id: string }) => input)
  .handler(async ({ context, data }): Promise<InviteDelivery> => {
    const { staffContext, deliverInvite } = await import("@/lib/employees-runtime.server");
    const { renewInvite } = await import("@/lib/staff-invite");
    const { sql, actor } = await staffContext(context.userId);
    const renewed = await renewInvite(sql, actor, data.id);
    return deliverInvite({ ...renewed, agency: await readAgency(sql) });
  });

export const editEmployee = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { id: string; kind: "member" | "invite"; name: string; level?: string; roles?: string[]; creatorIds: string[]; perms?: string[] }) => input)
  .handler(async ({ context, data }) => {
    const { staffContext } = await import("@/lib/employees-runtime.server");
    const { editEmployee: edit } = await import("@/lib/staff-invite");
    const { sql, actor } = await staffContext(context.userId);
    await edit(sql, actor, data.id, data.kind, data);
    return { ok: true as const };
  });

export const setEmployeeActive = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { id: string; active: boolean }) => input)
  .handler(async ({ context, data }) => {
    const { staffContext } = await import("@/lib/employees-runtime.server");
    const { setEmployeeActive: setActive } = await import("@/lib/staff-invite");
    const { sql, actor } = await staffContext(context.userId);
    await setActive(sql, actor, data.id, data.active);
    return { ok: true as const };
  });

/** Roles en grupo: cada empleado recibe estos roles y el preset de permisos de ellos. */
export const setEmployeeRoles = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { targets: Array<{ id: string; kind: "member" | "invite" }>; roles: string[] }) => input)
  .handler(async ({ context, data }) => {
    const { staffContext } = await import("@/lib/employees-runtime.server");
    const { setEmployeeRoles: apply } = await import("@/lib/staff-invite");
    const { sql, actor } = await staffContext(context.userId);
    await apply(sql, actor, data.targets, data.roles);
    return { ok: true as const };
  });

/** Restablecer contraseña: genera un enlace de un solo uso (24 h) y lo envía por correo si hay proveedor. */
export const resetEmployeePassword = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { id: string }) => input)
  .handler(async ({ context, data }): Promise<InviteDelivery> => {
    const { staffContext, deliverReset } = await import("@/lib/employees-runtime.server");
    const { createPasswordReset } = await import("@/lib/staff-invite");
    const { sql, actor } = await staffContext(context.userId);
    const created = await createPasswordReset(sql, actor, data.id);
    return deliverReset({ ...created, agency: await readAgency(sql) });
  });

export const deleteEmployee = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { id: string; kind: "member" | "invite" }) => input)
  .handler(async ({ context, data }) => {
    const { staffContext } = await import("@/lib/employees-runtime.server");
    const { deleteEmployee: remove } = await import("@/lib/staff-invite");
    const { sql, actor } = await staffContext(context.userId);
    await remove(sql, actor, data.id, data.kind);
    return { ok: true as const };
  });

async function readAgency(sql: { query<T>(text: string, params?: unknown[]): Promise<T[]> }): Promise<string | undefined> {
  const rows = await sql.query<{ agency: string | null }>("select state->>'agency' as agency from workspace_state where id = 1");
  return rows[0]?.agency?.trim() || undefined;
}
