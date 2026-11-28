import { auth } from "@/lib/auth/server";
import { getSql } from "@/lib/db";
import {
  activateInvitedStaff,
  claimInvite,
  inspectInvite,
  releaseInvite,
  validatePassword,
  type InviteState,
} from "@/lib/staff-invite";
import { WorkspaceAccessError } from "@/lib/access-policy";

export const INVITE_STATE_MESSAGES: Record<Exclude<InviteState, "ok">, string> = {
  invalid: "Este enlace de invitación no es válido.",
  expired: "Esta invitación ha caducado. Pide a la dueña que te la reenvíe.",
  used: "Esta invitación ya se usó. Entra con tu correo y tu contraseña.",
  revoked: "Esta invitación se canceló. Pide a la dueña una nueva.",
};

function json(body: unknown, status = 200, extra?: Headers): Response {
  const headers = new Headers(extra);
  headers.set("content-type", "application/json");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(body), { status, headers });
}

/** Pasa las cookies de sesión de la respuesta de Better Auth a la nuestra. */
function withSessionCookies(from: Response): Headers {
  const headers = new Headers();
  for (const cookie of from.headers.getSetCookie()) headers.append("set-cookie", cookie);
  return headers;
}

export async function previewInvitation(token: string): Promise<Response> {
  const result = await inspectInvite(await getSql(), token);
  if (result.state !== "ok") return json({ state: result.state, message: INVITE_STATE_MESSAGES[result.state] }, 200);
  return json({ state: "ok", name: result.name, email: result.email });
}

export async function acceptInvitation(request: Request, token: string, password: unknown): Promise<Response> {
  let clean: string;
  try {
    clean = validatePassword(password);
  } catch (error) {
    return json({ error: error instanceof WorkspaceAccessError ? error.message : "Contraseña no válida." }, 400);
  }
  const sql = await getSql();
  const claimed = await claimInvite(sql, token);
  if (!claimed.ok) return json({ state: claimed.state, error: INVITE_STATE_MESSAGES[claimed.state] }, 410);
  const invite = claimed.invite;
  let userId: string | null = null;
  try {
    const ctx = await auth.$context;
    if (await ctx.internalAdapter.findUserByEmail(invite.email)) {
      throw new WorkspaceAccessError("Ya hay una cuenta con ese correo.");
    }
    const hash = await ctx.password.hash(clean);
    const user = await ctx.internalAdapter.createUser({ email: invite.email, name: invite.name, emailVerified: true });
    userId = user.id;
    await ctx.internalAdapter.linkAccount({ userId: user.id, providerId: "credential", accountId: user.id, password: hash });
    await activateInvitedStaff(sql, invite, user.id);
  } catch (error) {
    if (userId) await sql.query(`delete from "user" where "id" = $1`, [userId]).catch(() => undefined);
    await releaseInvite(sql, invite.id);
    if (error instanceof WorkspaceAccessError) return json({ error: error.message }, 409);
    console.error("[invitation] no se pudo crear la cuenta", error);
    return json({ error: "No se ha podido crear la cuenta. Inténtalo otra vez." }, 500);
  }
  const session = await auth.api.signInEmail({
    body: { email: invite.email, password: clean },
    headers: request.headers,
    asResponse: true,
  });
  if (!session.ok) return json({ ok: true, signedIn: false }, 200);
  return json({ ok: true, signedIn: true }, 200, withSessionCookies(session));
}

const attempts = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 10;

function throttled(key: string, now: number): boolean {
  const entry = attempts.get(key);
  if (!entry || entry.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_ATTEMPTS;
}

export async function staffLogin(request: Request, email: unknown, password: unknown): Promise<Response> {
  if (typeof email !== "string" || typeof password !== "string" || !email.trim() || !password) {
    return json({ error: "Escribe tu correo y tu contraseña." }, 400);
  }
  const normalized = email.trim().toLowerCase();
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (throttled(`${ip}|${normalized}`, Date.now())) {
    return json({ error: "Demasiados intentos. Espera unos minutos." }, 429);
  }
  const session = await auth.api.signInEmail({
    body: { email: normalized, password },
    headers: request.headers,
    asResponse: true,
  });
  if (!session.ok) return json({ error: "Correo o contraseña incorrectos." }, 401);
  // Una cuenta desactivada no recibe sesión.
  const user = (await session.clone().json().catch(() => null)) as { user?: { id?: string } } | null;
  const id = user?.user?.id;
  if (id) {
    const { isStaffDisabled } = await import("@/lib/staff-invite");
    if (await isStaffDisabled(await getSql(), id)) {
      await getSql().then((sql) => sql.query(`delete from "session" where "userId" = $1`, [id]));
      return json({ error: "Tu cuenta está desactivada. Habla con la dueña." }, 403);
    }
  }
  return json({ ok: true }, 200, withSessionCookies(session));
}

export async function staffLogout(request: Request): Promise<Response> {
  const response = await auth.api.signOut({ headers: request.headers, asResponse: true });
  return json({ ok: true }, 200, withSessionCookies(response));
}
