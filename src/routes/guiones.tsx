import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { ScriptsPage } from "@/features/growth-pages";

export const Route = createFileRoute("/guiones")({
  component: () => (
    <AppShell>
      <ScriptsPage />
    </AppShell>
  ),
});
