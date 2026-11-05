import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { CreatorsPage } from "@/features/control-pages";

export const Route = createFileRoute("/creadoras")({
  component: () => (
    <AppShell>
      <CreatorsPage />
    </AppShell>
  ),
});
