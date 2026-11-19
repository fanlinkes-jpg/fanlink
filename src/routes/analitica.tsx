import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { AnalyticsPage } from "@/features/control-pages";

type AnalyticsView = "creadoras" | "equipo" | "fans";

export const Route = createFileRoute("/analitica")({
  validateSearch: (search: Record<string, unknown>): { vista?: AnalyticsView } => {
    if (search.vista === "creadoras" || search.vista === "equipo" || search.vista === "fans") {
      return { vista: search.vista };
    }
    return {};
  },
  component: AnaliticaRoute,
});

function AnaliticaRoute() {
  const { vista } = Route.useSearch();
  return (
    <AppShell>
      <AnalyticsPage key={vista ?? "creadoras"} initialView={vista} />
    </AppShell>
  );
}
