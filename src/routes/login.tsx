import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { FanlinkLogo } from "@/components/brand/FanlinkLogo";
import { GROK_PROVIDERS, authEnabled, signIn } from "@/lib/auth/client";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

function EmployeeLogin() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/staff-login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const body = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!response.ok || !body.ok) {
        setError(body.error ?? "No se ha podido entrar.");
        return;
      }
      window.location.assign("/");
    } catch {
      setError("El servidor no responde. Inténtalo otra vez.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="mt-5 space-y-2 border-t border-[#e6e8ee] pt-4" aria-label="Acceso de empleados invitados">
      <p className="text-sm font-medium">Empleados invitados</p>
      <input
        type="email"
        autoComplete="username"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        required
        placeholder="Correo"
        aria-label="Correo"
        className="w-full rounded-xl border border-[#e6e8ee] px-3 py-2 text-sm"
      />
      <input
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        required
        placeholder="Contraseña"
        aria-label="Contraseña"
        className="w-full rounded-xl border border-[#e6e8ee] px-3 py-2 text-sm"
      />
      {error && <p role="alert" className="text-sm text-[#c0392b]">{error}</p>}
      <button type="submit" disabled={busy} className="w-full rounded-xl bg-[#3b6cff] px-4 py-2.5 text-sm font-medium text-white disabled:opacity-60">
        {busy ? "Entrando…" : "Entrar"}
      </button>
      <p className="text-xs text-[#6d7585]">Solo para quien ha recibido una invitación por correo.</p>
    </form>
  );
}

function LoginPage() {
  return (
    <main className="grid min-h-dvh place-items-center bg-[#f4f6f8] px-5 text-[#1c2333]">
      <div className="w-full max-w-sm rounded-2xl border border-[#e6e8ee] bg-white p-6">
        <FanlinkLogo wordmark className="text-2xl" markClassName="h-10 w-10" />
        <p className="mt-4 font-display text-2xl font-semibold">Entrar en Fanlink</p>
        <p className="mt-2 text-sm text-[#6d7585]">
          Cada persona entra con su cuenta. La bandeja, los precios y el equipo son los mismos en todas las sesiones.
        </p>
        <div className="mt-5 space-y-2">
          {authEnabled ? (
            GROK_PROVIDERS.map((provider) => (
              <button
                key={provider.providerId}
                type="button"
                onClick={() => signIn(provider.providerId, { callbackURL: "/" })}
                className="w-full rounded-xl border border-[#e6e8ee] px-4 py-2.5 text-sm font-medium hover:bg-[#f4f6f8]"
              >
                Continuar con {provider.label}
              </button>
            ))
          ) : (
            <p className="text-sm text-[#6d7585]">El acceso todavía no está activo.</p>
          )}
        </div>
        <EmployeeLogin />
        <p className="mt-4 text-xs text-[#6d7585]">Esto no entra en OnlyFans. Solo abre la consola compartida.</p>
        <Link to="/" className="mt-4 inline-block text-sm text-[#3b6cff]">Volver</Link>
      </div>
    </main>
  );
}
