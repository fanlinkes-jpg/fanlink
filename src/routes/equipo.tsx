import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { TeamPage } from "@/features/control-pages";

export const Route = createFileRoute("/equipo")({
  component: () => (
    <AppShell>
      <TeamPage />
    </AppShell>
  ),
});
