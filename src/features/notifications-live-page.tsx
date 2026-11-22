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
        title="Operativa"
        hint="Solo la dueña puede abrir la página real de OnlyFans."
      />
    );
  }

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {!creatorId || creatorId === "all" || !creator ? (
          <ComingSoonPage
            title="Operativa"
            hint="Elige una creadora a la izquierda. La página de OnlyFans se abre en el centro, empezando por Notificaciones."
          />
        ) : (
          <LiveOfViewer key={creator.id} creatorId={creator.id} section="notifications" />
        )}
      </div>
    </div>
  );
}
