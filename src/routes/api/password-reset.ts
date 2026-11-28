import { createFileRoute } from "@tanstack/react-router";

type ResetBody = { token?: unknown; password?: unknown };

export const Route = createFileRoute("/api/password-reset")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { previewPasswordReset } = await import("@/lib/invitation-accept.server");
        const token = new URL(request.url).searchParams.get("token") ?? "";
        return previewPasswordReset(token);
      },
      POST: async ({ request }) => {
        const { acceptPasswordReset } = await import("@/lib/invitation-accept.server");
        const body = (await request.json().catch(() => ({}))) as ResetBody;
        return acceptPasswordReset(typeof body.token === "string" ? body.token : "", body.password);
      },
    },
  },
});
