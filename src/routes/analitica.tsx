import { createFileRoute } from "@tanstack/react-router";
import { legacyRedirectThrow } from "@/lib/route-redirect";

type AnalyticsView = "creadoras" | "equipo" | "fans";

export const Route = createFileRoute("/analitica")({
  validateSearch: (search: Record<string, unknown>): { vista?: AnalyticsView } => {
    if (search.vista === "creadoras" || search.vista === "equipo" || search.vista === "fans") {
      return { vista: search.vista };
    }
    return {};
  },
  beforeLoad: ({ search }) => {
    legacyRedirectThrow("/analitica", search);
  },
});
