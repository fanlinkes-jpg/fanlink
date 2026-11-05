import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { SettingsPage } from "@/features/control-pages";

export const Route = createFileRoute("/ajustes")({
  component: () => (
    <AppShell>
      <SettingsPage />
    </AppShell>
  ),
});
