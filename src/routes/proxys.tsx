import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { ProxysPage } from "@/features/proxys-page";

export const Route = createFileRoute("/proxys")({
  component: () => (
    <AppShell>
      <ProxysPage />
    </AppShell>
  ),
});
