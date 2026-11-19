import { ComingSoonPage } from "@/features/coming-soon-page";
import { LiveOfViewer } from "@/features/live-of-viewer";
import { useCrm } from "@/lib/crm";

export function NotificationsLivePage() {
  const teamAccess = useCrm((s) => s.teamAccess);
  const creatorId = useCrm((s) => s.creatorId);
  const creators = useCrm((s) => s.creators);
  const creator = creators.find((item) => item.id === creatorId);

  if (teamAccess?.role !== "owner") {
    return (
      <ComingSoonPage
        title="Notificaciones"
        hint="Solo la dueña puede abrir la página real de notificaciones de OnlyFans."
      />
    );
  }

  if (!creatorId || creatorId === "all" || !creator) {
    return (
      <ComingSoonPage
        title="Notificaciones"
        hint="Elige una creadora a la izquierda para ver su página de notificaciones en OnlyFans."
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-line px-4 py-3">
        <h1 className="font-display text-xl font-semibold">Notificaciones</h1>
        <p className="text-sm text-muted">
          Página real de OnlyFans de {creator.name}. Si la vista nativa está apagada, aquí verás el motivo.
        </p>
      </div>
      <LiveOfViewer key={creator.id} creatorId={creator.id} section="notifications" />
    </div>
  );
}
