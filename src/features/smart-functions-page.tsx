import { useNavigate } from "@tanstack/react-router";
import { ComingSoonPage } from "@/features/coming-soon-page";
import { AutomationsPage, CampaignsPage, LinksPage, ListsPage, ScriptsPage, VaultPage } from "@/features/growth-pages";
import { useCrm } from "@/lib/crm";
import { FUNCTION_TABS, navRoleFromAccess, visibleFunctionTabs, type FunctionTabId } from "@/lib/nav-config";

export function SmartFunctionsPage({ tab }: { tab: FunctionTabId }) {
  const navigate = useNavigate();
  const teamAccess = useCrm((s) => s.teamAccess);
  const allowed = visibleFunctionTabs(navRoleFromAccess(teamAccess), teamAccess);
  const current = allowed.includes(tab) ? tab : allowed[0];

  if (!current) {
    return (
      <div className="p-6">
        <h1 className="font-display text-2xl font-semibold">Funciones inteligentes</h1>
        <p className="mt-2 text-sm text-muted">No tienes acceso a estas funciones.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3 px-4 pt-4 md:px-6 md:pt-6">
        <div>
          <h1 className="font-display text-2xl font-semibold">Funciones inteligentes</h1>
          <p className="text-sm text-muted">Masivos, listas, bóveda, guiones y enlaces en una sola sección.</p>
        </div>
        <div className="flex max-w-full gap-1 overflow-auto rounded-md border border-line p-1">
          {FUNCTION_TABS.filter((item) => allowed.includes(item.id)).map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => void navigate({ to: "/funciones", search: { tab: item.id }, replace: true })}
              className={`shrink-0 rounded-md px-3 py-1 text-sm ${current === item.id ? "bg-raised text-fg" : "text-muted"}`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      <FunctionBody tab={current} />
    </div>
  );
}

function FunctionBody({ tab }: { tab: FunctionTabId }) {
  switch (tab) {
    case "masivos":
      return <CampaignsPage />;
    case "listas":
      return <ListsPage />;
    case "auto-seguir":
      return <AutomationsPage />;
    case "vault":
      return <VaultPage />;
    case "guiones":
      return <ScriptsPage />;
    case "promocion":
      return <ComingSoonPage title="Promoción de perfil" hint="Pruebas y campañas" />;
    case "prueba":
      return <ComingSoonPage title="Enlaces de prueba gratuita" hint="Acceso gratuito" />;
    case "enlaces":
      return <LinksPage />;
    default: {
      const exhaustive: never = tab;
      return exhaustive;
    }
  }
}
