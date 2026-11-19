import { useState } from "react";
import { CreatorsPage, TeamPage } from "@/features/control-pages";

export type AdminTab = "creadores" | "equipos";

export function AdminPage({ initialTab }: { initialTab?: AdminTab }) {
  const [tab, setTab] = useState<AdminTab>(initialTab ?? "creadores");

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3 px-4 pt-4 md:px-6 md:pt-6">
        <div>
          <h1 className="font-display text-2xl font-semibold">Administrar</h1>
          <p className="text-sm text-muted">Creadores y equipos en una sola pantalla.</p>
        </div>
        <div className="flex gap-1 rounded-md border border-line p-1">
          {([
            ["creadores", "Creadores"],
            ["equipos", "Equipos"],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`rounded-md px-3 py-1 text-sm ${tab === id ? "bg-raised text-fg" : "text-muted"}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {tab === "creadores" ? <CreatorsPage /> : <TeamPage />}
    </div>
  );
}
