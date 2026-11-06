import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { listDashboard, type DashboardView } from "@/lib/of-sessions";
import { Panel } from "@/components/ui";

export function HomePage() {
  const [data, setData] = useState<DashboardView | null>(null);
  useEffect(() => {
    void listDashboard().then(setData).catch(() => setData(null));
  }, []);
  const owner = data?.role === "owner";
  const kpis = [
    { label: "Ingresos del día", value: money(owner ? data?.dayGrossCents ?? null : null, owner) },
    { label: "Ingresos del mes", value: money(owner ? data?.monthGrossCents ?? null : null, owner) },
    { label: "Fans activos", value: data?.activeFans == null ? "Sin datos" : String(data.activeFans) },
    { label: "Alertas", value: data ? String(data.alerts.length) : "Sin datos" },
  ];

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight">Centro de mando</h1>
        <p className="text-sm text-muted">Cifras del día y del mes a partir de lo sincronizado. Si falta un dato, se queda en Sin datos.</p>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map((item) => (
          <article key={item.label} className="rounded-lg border border-line bg-surface p-4">
            <p className="text-xs text-muted">{item.label}</p>
            <p className="mt-2 font-display text-2xl font-semibold tabular-nums">{item.value}</p>
          </article>
        ))}
      </div>
      <div className="flex flex-wrap gap-2 text-sm">
        <Link to="/creadoras" className="rounded-md border border-line px-3 py-1">Creadoras</Link>
        <Link to="/analitica" className="rounded-md border border-line px-3 py-1">Analítica</Link>
        <Link to="/mensajes" className="rounded-md border border-line px-3 py-1">Chat</Link>
        <Link to="/campanas" className="rounded-md border border-line px-3 py-1">Campañas</Link>
      </div>
      <Panel title="Alertas">
        {!data || data.alerts.length === 0 ? (
          <p className="text-sm text-muted">Sin datos</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {data.alerts.map((alert) => (
              <li key={`${alert.kind}:${alert.text}`}>{alert.text}</li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function money(cents: number | null, owner: boolean): string {
  if (!owner) return "Los ingresos los ve la dueña";
  if (cents == null) return "Sin datos";
  return `$${(cents / 100).toFixed(2)}`;
}
