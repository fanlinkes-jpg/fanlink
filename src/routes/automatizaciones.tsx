import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { AutomationsPage } from "@/features/growth-pages";

export const Route = createFileRoute("/automatizaciones")({
  component: () => (
    <AppShell>
      <AutomationsPage />
    </AppShell>
  ),
});
