import { createFileRoute } from "@tanstack/react-router";

type AcceptBody = { token?: unknown; password?: unknown };

export const Route = createFileRoute("/api/invitation")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { previewInvitation } = await import("@/lib/invitation-accept.server");
        const token = new URL(request.url).searchParams.get("token") ?? "";
        return previewInvitation(token);
      },
      POST: async ({ request }) => {
        const { acceptInvitation } = await import("@/lib/invitation-accept.server");
        const body = (await request.json().catch(() => ({}))) as AcceptBody;
        return acceptInvitation(request, typeof body.token === "string" ? body.token : "", body.password);
      },
    },
  },
});
