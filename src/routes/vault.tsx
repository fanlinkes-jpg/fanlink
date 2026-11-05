import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { VaultPage } from "@/features/growth-pages";

export const Route = createFileRoute("/vault")({
  component: () => (
    <AppShell>
      <VaultPage />
    </AppShell>
  ),
});
