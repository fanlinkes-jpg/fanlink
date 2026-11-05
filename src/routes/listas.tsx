import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { ListsPage } from "@/features/growth-pages";

export const Route = createFileRoute("/listas")({
  component: () => (
    <AppShell>
      <ListsPage />
    </AppShell>
  ),
});
