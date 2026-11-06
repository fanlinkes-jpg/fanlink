import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { useCrm } from "@/lib/crm";
import {
  SESSION_STATUS_LABEL,
  sessionActionLabel,
  type SessionStatus,
} from "@/lib/of-sessions";
import {
  sessionErrorText,
  useCreatorSessions,
} from "@/lib/use-creator-sessions";

export const Route = createFileRoute("/conectar")({
  validateSearch: (search: Record<string, unknown>): { creadora?: string } => {
    const value = search.creadora;
    if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(value))
      return {};
    return { creadora: value };
  },
  component: () => (
    <AppShell>
      <ConnectPage />
    </AppShell>
  ),
});

function ConnectPage() {
  const { creadora } = Route.useSearch();
  const creators = useCrm((s) => s.creators);
  const sessions = useCreatorSessions();
  const creator = creators.find((item) => item.id === creadora);
  const [opening, setOpening] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const live = creator ? sessions.byCreator.get(creator.id) : undefined;
  const status: SessionStatus = live?.status ?? "pending_login";
  const busy = opening || Boolean(live?.loginInProgress);

  async function openWindow() {
    if (!creator || creator.platform !== "OnlyFans") return;
    setOpening(true);
    setLocalError(null);
    try {
      await sessions.connect({
        creatorId: creator.id,
        label: creator.name.trim().slice(0, 80) || "Creadora",
        platform: "OnlyFans",
      });
    } catch (error) {
      setLocalError(sessionErrorText(error));
    } finally {
      setOpening(false);
    }
  }

  return (
    <div className="grid min-h-full place-items-center bg-[#f4f6f8] p-6 text-[#1c2333]">
      <div className="w-full max-w-md rounded-2xl border border-[#e6e8ee] bg-white p-6">
        <p className="font-display text-2xl font-semibold">Conectar OnlyFans</p>
        <p className="mt-2 text-sm text-[#6d7585]">
          La dueña entra en una ventana de Chromium en el equipo donde corre
          Fanlink. El captcha y el doble factor se resuelven ahí. Esta pantalla
          no pide ni guarda la contraseña.
        </p>
        <p className="mt-2 text-sm text-[#6d7585]">
          Entrar en Fanlink es la sesión del equipo. No tiene nada que ver con
          la cuenta de OnlyFans.
        </p>

        {!creadora && <CreatorPicker creators={creators} />}

        {creadora && !creator && (
          <p className="mt-5 text-sm text-[#8a5a12]">
            No está esa creadora en la consola.
          </p>
        )}

        {creator && creator.platform !== "OnlyFans" && (
          <p className="mt-5 text-sm text-[#8a5a12]">
            {creator.name} está en {creator.platform}. La ventana de Chromium
            solo conecta OnlyFans.
          </p>
        )}

        {creator && creator.platform === "OnlyFans" && (
          <div className="mt-5 space-y-3">
            <p className="text-sm">
              <span className="font-medium">{creator.name}</span>
              <span className="text-[#6d7585]"> · {creator.handle}</span>
            </p>
            <p>
              {live || (sessions.ready && !sessions.error) ? (
                <span
                  className={`rounded-full px-2 py-1 text-xs ${tone(status)}`}
                >
                  {SESSION_STATUS_LABEL[status]}
                </span>
              ) : sessions.ready ? (
                <span className="text-xs text-[#8a5a12]">
                  Sin datos de sesión
                </span>
              ) : (
                <span className="text-xs text-[#6d7585]">
                  Cargando el estado…
                </span>
              )}
            </p>
            <button
              type="button"
              onClick={() => void openWindow()}
              disabled={busy}
              className="w-full rounded-xl bg-[#ff7a2f] px-4 py-2.5 text-sm font-medium text-white disabled:opacity-60"
            >
              {busy
                ? "Abriendo la ventana…"
                : sessionActionLabel(status) === "Reconectar"
                  ? "Reconectar"
                  : "Abrir ventana de OnlyFans"}
            </button>
            {busy && (
              <p className="text-sm text-[#6d7585]">
                Mira el escritorio del servidor. Cuando la página llegue al
                feed, esta ficha pasará a activa y las cookies quedarán
                cifradas.
              </p>
            )}
            {live?.lastError && !busy && (
              <p className="text-sm text-[#8a5a12]">{live.lastError}</p>
            )}
          </div>
        )}

        {(localError || sessions.error) && (
          <p className="mt-3 text-sm text-[#8a5a12]">
            {localError || sessions.error}
          </p>
        )}

        <Link
          to="/creadoras"
          className="mt-4 inline-block text-sm text-[#3b6cff]"
        >
          Volver a creadoras
        </Link>
      </div>
    </div>
  );
}

function CreatorPicker({
  creators,
}: {
  creators: Array<{
    id: string;
    name: string;
    platform: string;
    handle: string;
  }>;
}) {
  const onlyFans = creators.filter(
    (creator) => creator.platform === "OnlyFans",
  );
  if (onlyFans.length === 0) {
    return (
      <p className="mt-5 text-sm text-[#6d7585]">
        Añade una creadora de OnlyFans en Administrar creadoras y vuelve para
        abrir la ventana.
      </p>
    );
  }
  return (
    <ul className="mt-5 space-y-2">
      {onlyFans.map((creator) => (
        <li key={creator.id}>
          <Link
            to="/conectar"
            search={{ creadora: creator.id }}
            className="flex items-center justify-between rounded-xl border border-[#e6e8ee] px-3 py-2 text-sm hover:bg-[#f4f6f8]"
          >
            <span>{creator.name}</span>
            <span className="text-[#6d7585]">{creator.handle}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function tone(status: SessionStatus): string {
  switch (status) {
    case "active":
      return "bg-emerald-50 text-emerald-700";
    case "pending_login":
      return "bg-amber-50 text-amber-700";
    case "expired":
      return "bg-red-50 text-red-700";
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}
