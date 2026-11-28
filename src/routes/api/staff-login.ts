import { createFileRoute } from "@tanstack/react-router";

type LoginBody = { email?: unknown; password?: unknown };

export const Route = createFileRoute("/api/staff-login")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { staffLogin } = await import("@/lib/invitation-accept.server");
        const body = (await request.json().catch(() => ({}))) as LoginBody;
        return staffLogin(request, body.email, body.password);
      },
      DELETE: async ({ request }) => {
        const { staffLogout } = await import("@/lib/invitation-accept.server");
        return staffLogout(request);
      },
    },
  },
});
