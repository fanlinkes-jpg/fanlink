import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { AnalyticsPage } from "@/features/control-pages";

export const Route = createFileRoute("/analitica")({
  component: () => (
    <AppShell>
      <AnalyticsPage />
    </AppShell>
  ),
});
