import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";

export const Route = createFileRoute("/conectar")({
  component: () => (
    <AppShell>
      <ConnectPage />
    </AppShell>
  ),
});

function ConnectPage() {
  const [platform, setPlatform] = useState("OnlyFans");
  const [notice, setNotice] = useState("");

  return (
    <div className="grid min-h-full place-items-center bg-[#f4f6f8] p-6 text-[#1c2333]">
      <form
        className="w-full max-w-sm rounded-2xl border border-[#e6e8ee] bg-white p-6"
        onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget;
          form.reset();
          setNotice("Aquí se corta. La clave no se ha enviado ni se ha guardado.");
        }}
      >
        <p className="font-display text-2xl font-semibold">Conectar cuenta</p>
        <p className="mt-2 text-sm text-[#6d7585]">
          Pantalla de acceso de la creadora. La consola llega hasta aquí.
        </p>
        <label className="mt-5 block text-xs font-medium text-[#6d7585]">
          Plataforma
          <select
            value={platform}
            onChange={(e) => setPlatform(e.target.value)}
            className="mt-1 w-full rounded-xl border border-[#e6e8ee] px-3 py-2 text-sm text-[#1c2333]"
          >
            {["OnlyFans", "Fansly", "Fanvue", "MYM"].map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </label>
        <label className="mt-3 block text-xs font-medium text-[#6d7585]">
          Usuario
          <input autoComplete="off" className="mt-1 w-full rounded-xl border border-[#e6e8ee] px-3 py-2 text-sm" placeholder="usuario de la cuenta" />
        </label>
        <label className="mt-3 block text-xs font-medium text-[#6d7585]">
          Contraseña
          <input type="password" autoComplete="new-password" className="mt-1 w-full rounded-xl border border-[#e6e8ee] px-3 py-2 text-sm" placeholder="••••••••" />
        </label>
        <button type="submit" className="mt-5 w-full rounded-xl bg-[#ff7a2f] px-4 py-2.5 text-sm font-medium text-white">
          Entrar en {platform}
        </button>
        {notice && <p className="mt-3 text-xs text-[#8a5a12]">{notice}</p>}
        <p className="mt-4 text-xs text-[#6d7585]">No inicia sesión. El usuario y la clave no salen de esta pantalla.</p>
        <Link to="/creadoras" className="mt-4 inline-block text-sm text-[#3b6cff]">Volver a creadoras</Link>
      </form>
    </div>
  );
}
