import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { AdminPage, readAdminTab, type AdminTab } from "@/features/admin-page";

export const Route = createFileRoute("/administrar")({
  validateSearch: (search: Record<string, unknown>): { tab?: AdminTab } => {
    const tab = readAdminTab(search.tab);
    return tab ? { tab } : {};
  },
  component: AdministrarRoute,
});

function AdministrarRoute() {
  const { tab } = Route.useSearch();
  return (
    <AppShell>
      <AdminPage key={tab ?? "creadoras"} initialTab={tab} />
    </AppShell>
  );
}
