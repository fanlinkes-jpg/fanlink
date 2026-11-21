import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { ComingSoonPage } from "@/features/coming-soon-page";
import { legacyRedirect } from "@/lib/nav-config";
import { legacyRedirectThrow } from "@/lib/route-redirect";

export const Route = createFileRoute("/proximamente/$seccion")({
  beforeLoad: ({ params }) => {
    const path = `/proximamente/${params.seccion}`;
    if (legacyRedirect(path)) legacyRedirectThrow(path);
  },
  component: ComingSoonRoute,
});

function ComingSoonRoute() {
  const { seccion } = Route.useParams();
  return (
    <AppShell>
      <ComingSoonPage title="Esta sección" hint={seccion} />
    </AppShell>
  );
}
