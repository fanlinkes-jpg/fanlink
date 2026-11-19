import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { AdminPage, type AdminTab } from "@/features/admin-page";

export const Route = createFileRoute("/administrar")({
  validateSearch: (search: Record<string, unknown>): { tab?: AdminTab } => {
    if (search.tab === "creadores" || search.tab === "equipos") return { tab: search.tab };
    return {};
  },
  component: AdministrarRoute,
});

function AdministrarRoute() {
  const { tab } = Route.useSearch();
  return (
    <AppShell>
      <AdminPage key={tab ?? "creadores"} initialTab={tab} />
    </AppShell>
  );
}
