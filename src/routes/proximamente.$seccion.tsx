import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { ComingSoonPage } from "@/features/coming-soon-page";
import { comingSoonSection } from "@/lib/nav-config";

export const Route = createFileRoute("/proximamente/$seccion")({
  component: ComingSoonRoute,
});

function ComingSoonRoute() {
  const { seccion } = Route.useParams();
  const item = comingSoonSection(seccion);
  return (
    <AppShell>
      <ComingSoonPage title={item?.label ?? "Esta sección"} hint={item?.hint} />
    </AppShell>
  );
}
