import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { NotificationsLivePage } from "@/features/notifications-live-page";

export const Route = createFileRoute("/notificaciones")({
  component: () => (
    <AppShell bleed>
      <NotificationsLivePage />
    </AppShell>
  ),
});
