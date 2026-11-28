import { useState, type ComponentType } from "react";
import { Archive, BarChart3, Bell, FileSignature, House, Landmark, Layers, Lock, Receipt, Settings, SquarePen, User } from "lucide-react";
import { ComingSoonPage } from "@/features/coming-soon-page";
import { LiveOfViewer } from "@/features/live-of-viewer";
import { useCrm } from "@/lib/crm";
import { DESK_PAGES, type DeskPageId } from "../../server/of-sessions/live/sections.ts";

const PAGE_ICONS: Record<DeskPageId, ComponentType<{ className?: string; "aria-hidden"?: boolean }>> = {
  home: House,
  "new-post": SquarePen,
  notifications: Bell,
  vault: Lock,
  archive: Archive,
  collections: Layers,
  statements: Receipt,
  statistics: BarChart3,
  banking: Landmark,
  profile: User,
  settings: Settings,
  "release-forms": FileSignature,
};

/** Operativa: el menú de secciones a la izquierda de la página y, dentro, la pantalla real de OnlyFans de una sola creadora. */
export function NotificationsLivePage() {
  const teamAccess = useCrm((s) => s.teamAccess);
  const creatorId = useCrm((s) => s.creatorId);
  const creators = useCrm((s) => s.creators);
  const creator = creators.find((item) => item.id === creatorId);
  const [page, setPage] = useState<DeskPageId>("notifications");

  if (teamAccess?.role !== "owner") {
    return (
      <ComingSoonPage
        title="Operaciones"
        hint="Solo la dueña puede abrir la página real de OnlyFans."
      />
    );
  }

  return (
    <div className="flex h-full min-h-0">
      <nav aria-label="Secciones de OnlyFans" className="flex w-52 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-[#e6e8ee] bg-white px-2 py-3">
        {DESK_PAGES.map((item) => {
          const Icon = PAGE_ICONS[item.id];
          const active = item.id === page;
          return (
            <button
              key={item.id}
              type="button"
              aria-current={active ? "page" : undefined}
              onClick={() => setPage(item.id)}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-left text-sm ${active ? "bg-[#eef2ff] font-medium text-[#2456c7]" : "text-[#3b4252] hover:bg-[#f4f7ff]"}`}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden />
              <span className="truncate">{item.label}</span>
            </button>
          );
        })}
      </nav>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {!creatorId || creatorId === "all" || !creator ? (
          <ComingSoonPage
            title="Operaciones"
            hint="Elige una creadora a la izquierda y una sección del menú. Se abre esa pantalla de OnlyFans, de una sola creadora a la vez."
          />
        ) : (
          <LiveOfViewer key={creator.id} creatorId={creator.id} section="notifications" page={page} />
        )}
      </div>
    </div>
  );
}
