import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { MessagesPage } from "@/features/messages-page";

export const Route = createFileRoute("/mensajes")({
  component: () => (
    <AppShell bleed>
      <MessagesPage />
    </AppShell>
  ),
});
