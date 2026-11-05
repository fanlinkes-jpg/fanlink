import { useCrm } from "@/lib/crm";
import { Panel } from "@/components/ui";

export function HomePage() {
  const creators = useCrm((s) => s.creators);
  const creatorId = useCrm((s) => s.creatorId);

  const kpis = [
    { label: "Ingresos 24 h", value: "Sin sincronizar", hint: "Se ven en Analítica" },
    { label: "Desbloqueo PPV", value: "Sin sincronizar", hint: "No hay envíos leídos" },
    { label: "Fans activos", value: "Sin sincronizar", hint: "Se ven en Analítica" },
    { label: "Respuesta media", value: "Sin sincronizar", hint: "No sale de OnlyFans" },
  ];

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight">Centro de mando</h1>
        <p className="text-sm text-muted">Los ingresos, los fans y los chats salen de OnlyFans después de sincronizar. Aquí no hay cifras hasta entonces.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map((k) => (
          <article key={k.label} className="rounded-lg border border-line bg-surface p-4">
            <p className="text-xs text-muted">{k.label}</p>
            <p className="mt-2 font-display text-2xl font-semibold tabular-nums">{k.value}</p>
            <p className="mt-1 text-xs text-muted">{k.hint}</p>
          </article>
        ))}
      </div>

      <div className="grid gap-3 lg:grid-cols-5">
        <Panel title="Tendencia de ingresos" className="lg:col-span-3">
          <p className="text-sm text-muted">Sin sincronizar. Analítica muestra el ingreso cuando la dueña sincroniza la cuenta.</p>
        </Panel>

        <Panel title="Lecturas" className="lg:col-span-2">
          <p className="text-sm text-muted">Fans, chats y masivos en borrador usan lo guardado. No hay envío real.</p>
        </Panel>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Panel title="Creadoras" bodyClass="p-0">
          <ul>
            {creators
              .filter((c) => creatorId === "all" || c.id === creatorId)
              .map((c) => (
                <li key={c.id} className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-0">
                  <span className="grid h-9 w-9 place-items-center rounded-md text-xs font-semibold text-fg" style={{ background: `hsl(${c.hue} 32% 28%)` }}>
                    {c.name.slice(0, 2)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{c.name}</p>
                    <p className="truncate text-xs text-muted">{c.handle} · {c.platform} · {c.proxy}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-muted">Sin sincronizar</p>
                  </div>
                </li>
              ))}
          </ul>
        </Panel>

        <Panel title="Actividad reciente">
          <p className="text-sm text-muted">Sin sincronizar. Las conversaciones reales están en Chat.</p>
        </Panel>
      </div>
    </div>
  );
}
