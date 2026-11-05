import { createFileRoute, Link } from "@tanstack/react-router";
import { GROK_PROVIDERS, authEnabled, signIn } from "@/lib/auth/client";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

function LoginPage() {
  return (
    <main className="grid min-h-dvh place-items-center bg-[#f4f6f8] px-5 text-[#1c2333]">
      <div className="w-full max-w-sm rounded-2xl border border-[#e6e8ee] bg-white p-6">
        <p className="font-display text-2xl font-semibold">Entrar en Fanlink</p>
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
        <p className="mt-4 text-xs text-[#6d7585]">Esto no entra en OnlyFans. Solo abre la consola compartida.</p>
        <Link to="/" className="mt-4 inline-block text-sm text-[#3b6cff]">Volver</Link>
      </div>
    </main>
  );
}
