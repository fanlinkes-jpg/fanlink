import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { ConfigPage } from "@/features/config-page";

export const Route = createFileRoute("/configuracion")({
  component: () => (
    <AppShell>
      <ConfigPage />
    </AppShell>
  ),
});
