import { getRequest } from "@tanstack/react-start/server";
import { getSql } from "@/lib/db";
import { DEV_USER_ID, authConfigured } from "@/lib/auth/verify.server";
import { sendInviteMail, sendResetMail, type MailResult } from "@/lib/staff-mail";
import { ensureStaff, type StaffAccess } from "@/lib/workspace-store";

/** Origen público para el enlace de invitación. BETTER_AUTH_URL manda; si no, el de la petición. */
export function publicOrigin(): string {
  const configured = process.env.BETTER_AUTH_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  const request = getRequest();
  if (!request) return "http://localhost:8080";
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!host) return new URL(request.url).origin;
  const proto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim()
    ?? new URL(request.url).protocol.replace(":", "");
  return `${proto}://${host}`;
}

export function inviteLink(token: string): string {
  return `${publicOrigin()}/invitacion/${token}`;
}

export async function staffContext(userId: string): Promise<{ sql: Awaited<ReturnType<typeof getSql>>; actor: StaffAccess }> {
  const sql = await getSql();
  const actor = await ensureStaff(sql, userId, !authConfigured && userId === DEV_USER_ID);
  return { sql, actor };
}

export type InviteDelivery = {
  id: string;
  link: string;
  expiresAt: string;
  email: string;
  mail: MailResult;
};

export async function deliverInvite(input: {
  id: string;
  token: string;
  expiresAt: string;
  name: string;
  email: string;
  agency?: string;
}): Promise<InviteDelivery> {
  const link = inviteLink(input.token);
  const mail = await sendInviteMail({ to: input.email, name: input.name, link, agency: input.agency });
  return { id: input.id, link, expiresAt: input.expiresAt, email: input.email, mail };
}

export function resetLink(token: string): string {
  return `${publicOrigin()}/restablecer/${token}`;
}

/** Correo de reseteo. Sin proveedor de correo configurado, el enlace se devuelve para pasarlo a mano. */
export async function deliverReset(input: {
  id: string;
  token: string;
  expiresAt: string;
  name: string;
  email: string;
  agency?: string;
}): Promise<InviteDelivery> {
  const link = resetLink(input.token);
  const mail = await sendResetMail({ to: input.email, name: input.name, link, agency: input.agency });
  return { id: input.id, link, expiresAt: input.expiresAt, email: input.email, mail };
}
