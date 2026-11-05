import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { LinksPage } from "@/features/growth-pages";

export const Route = createFileRoute("/enlaces")({
  component: () => (
    <AppShell>
      <LinksPage />
    </AppShell>
  ),
});
