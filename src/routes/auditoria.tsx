import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { AuditPage } from "@/features/control-pages";

export const Route = createFileRoute("/auditoria")({
  component: () => (
    <AppShell>
      <AuditPage />
    </AppShell>
  ),
});
