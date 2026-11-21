import { CreatorMark } from "@/components/creator-mark";
import { ComingSoonPage } from "@/features/coming-soon-page";
import { LiveOfViewer } from "@/features/live-of-viewer";
import { useCrm } from "@/lib/crm";
import { useCreatorSessions } from "@/lib/use-creator-sessions";

export function NotificationsLivePage() {
  const teamAccess = useCrm((s) => s.teamAccess);
  const creatorId = useCrm((s) => s.creatorId);
  const creators = useCrm((s) => s.creators);
  const fans = useCrm((s) => s.fans);
  const setCreator = useCrm((s) => s.setCreator);
  const { sessions } = useCreatorSessions();
  const avatars = Object.fromEntries(sessions.map((session) => [session.creatorId, session.avatarUrl]));
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
      <aside className="flex w-56 shrink-0 flex-col border-r border-line bg-surface">
        <p className="px-3 py-3 text-xs font-semibold uppercase tracking-wide text-muted">Creadoras</p>
        <ul className="min-h-0 flex-1 overflow-auto">
          {creators.map((item) => {
            const alerts = fans.filter((fan) => fan.creatorId === item.id && fan.unread > 0).length;
            const active = item.id === creatorId;
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => setCreator(item.id)}
                  className={active ? "flex w-full items-center gap-2 bg-primary/10 px-3 py-2 text-left text-sm" : "flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-raised"}
                >
                  <CreatorMark name={item.name} hue={item.hue} avatarUrl={avatars[item.id]} size="md" />
                  <span className="min-w-0 flex-1 truncate">{item.name}</span>
                  {alerts > 0 ? <span className="rounded-full bg-danger px-1.5 text-[10px] font-semibold text-white">{alerts}</span> : null}
                </button>
              </li>
            );
          })}
        </ul>
      </aside>
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
