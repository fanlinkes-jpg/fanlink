import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { SmartFunctionsPage } from "@/features/smart-functions-page";
import { functionTab, type FunctionTabId } from "@/lib/nav-config";

export const Route = createFileRoute("/funciones")({
  validateSearch: (search: Record<string, unknown>): { tab: FunctionTabId } => ({
    tab: functionTab(search.tab),
  }),
  component: FuncionesRoute,
});

function FuncionesRoute() {
  const { tab } = Route.useSearch();
  return (
    <AppShell>
      <SmartFunctionsPage tab={tab} />
    </AppShell>
  );
}
