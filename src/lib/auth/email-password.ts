/**
 * Local email/password sign-in (this app's Better Auth DB — not the broker).
 *
 * On only for invited employees: `server.ts` sets `disableSignUp`, so nobody can
 * register. The only way to get a password account is accepting a `staff_invite`
 * (`/invitacion/<token>`), which creates the user server-side. The owner keeps
 * signing in as before.
 */
export const emailAndPasswordEnabled = true;
