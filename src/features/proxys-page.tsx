import { useCrm } from "@/lib/crm";
import { useCreatorSessions } from "@/lib/use-creator-sessions";
import { ProxyForm } from "@/features/control-pages";

export function ProxysPage() {
  const creators = useCrm((s) => s.creators);
  const sessions = useCreatorSessions();

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div>
        <h1 className="font-display text-2xl font-semibold">Proxy</h1>
        <p className="text-sm text-muted">IP de cada cuenta. Esta pantalla reutiliza el formulario que ya existía en creadoras.</p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {creators.map((creator) => {
          const live = sessions.byCreator.get(creator.id);
          return (
            <article key={creator.id} className="rounded-lg border border-line bg-surface p-4">
              <p className="font-medium">{creator.name}</p>
              <p className="text-xs text-muted">{creator.handle}</p>
              <ProxyForm
                creatorId={creator.id}
                label={live?.proxyLabel ?? null}
                onSaved={() => void sessions.refresh?.()}
              />
            </article>
          );
        })}
        {creators.length === 0 ? (
          <p className="text-sm text-muted">No hay cuentas para configurar un proxy.</p>
        ) : null}
      </div>
    </div>
  );
}
