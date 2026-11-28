import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { CreatorsPage } from "@/features/creators-page";
import { EmployeesPage } from "@/features/employees-page";
import { adminTab, type AdminTab } from "@/lib/nav-config";

export type { AdminTab };

const TABS = [
  ["creadoras", "Creadoras"],
  ["empleados", "Empleados"],
] as const;

export function AdminPage({ initialTab }: { initialTab?: AdminTab }) {
  const navigate = useNavigate();
  const [tab, setTab] = useState<AdminTab>(initialTab ?? "creadoras");

  function pick(next: AdminTab) {
    setTab(next);
    void navigate({ to: "/administrar", search: { tab: next }, replace: true });
  }

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3 px-4 pt-4 md:px-6 md:pt-6">
        <div>
          <h1 className="font-display text-2xl font-semibold">Personal</h1>
          <p className="text-sm text-muted">Creadoras y empleados del equipo.</p>
        </div>
        <div className="flex gap-1 rounded-md border border-line p-1">
          {TABS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => pick(id)}
              className={`rounded-md px-3 py-1 text-sm ${tab === id ? "bg-raised text-fg" : "text-muted"}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <AdminBody tab={tab} />
    </div>
  );
}

function AdminBody({ tab }: { tab: AdminTab }) {
  switch (tab) {
    case "creadoras":
      return <CreatorsPage />;
    case "empleados":
      return <EmployeesPage />;
    default: {
      const exhaustive: never = tab;
      return exhaustive;
    }
  }
}

export function readAdminTab(value: unknown): AdminTab | undefined {
  if (value === "creadoras" || value === "creadores" || value === "empleados" || value === "chatters" || value === "equipos") return adminTab(value);
  return undefined;
}
