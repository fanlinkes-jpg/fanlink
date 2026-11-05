import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { HomePage } from "@/features/home-page";

export const Route = createFileRoute("/")({
  component: () => (
    <AppShell>
      <HomePage />
    </AppShell>
  ),
});
