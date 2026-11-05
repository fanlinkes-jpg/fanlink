import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { CampaignsPage } from "@/features/growth-pages";

export const Route = createFileRoute("/campanas")({
  component: () => (
    <AppShell>
      <CampaignsPage />
    </AppShell>
  ),
});
