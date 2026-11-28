import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { FanlinkLogo } from "@/components/brand/FanlinkLogo";

export const Route = createFileRoute("/invitacion/$token")({
  component: InvitationPage,
});

type Preview =
  | { state: "loading" }
  | { state: "ok"; name: string; email: string }
  | { state: "invalid" | "expired" | "used" | "revoked"; message: string };

const MIN_LENGTH = 8;

function InvitationPage() {
  const { token } = Route.useParams();
  const [preview, setPreview] = useState<Preview>({ state: "loading" });
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stop = false;
    void fetch(`/api/invitation?token=${encodeURIComponent(token)}`)
      .then((response) => response.json() as Promise<Preview>)
      .then((value) => {
        if (!stop) setPreview(value);
      })
      .catch(() => {
        if (!stop) setPreview({ state: "invalid", message: "No se ha podido comprobar la invitación. Inténtalo otra vez." });
      });
    return () => {
      stop = true;
    };
  }, [token]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (password.length < MIN_LENGTH) {
      setError(`La contraseña necesita al menos ${MIN_LENGTH} caracteres.`);
      return;
    }
    if (password !== repeat) {
      setError("Las contraseñas no coinciden.");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/invitation", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const body = (await response.json().catch(() => ({}))) as { ok?: boolean; signedIn?: boolean; error?: string };
      if (!response.ok || !body.ok) {
        setError(body.error ?? "No se ha podido aceptar la invitación.");
        return;
      }
      window.location.assign(body.signedIn ? "/" : "/login");
    } catch {
      setError("El servidor no responde. Inténtalo otra vez.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-[#f4f6f8] px-5 text-[#1c2333]">
      <div className="w-full max-w-sm rounded-2xl border border-[#e6e8ee] bg-white p-6">
        <FanlinkLogo wordmark className="text-2xl" markClassName="h-10 w-10" />
        {preview.state === "loading" && <p className="mt-4 text-sm text-[#6d7585]">Comprobando la invitación…</p>}
        {preview.state === "ok" && (
          <form onSubmit={(event) => void submit(event)} className="mt-4 space-y-3">
            <p className="font-display text-2xl font-semibold">Hola, {preview.name}</p>
            <p className="text-sm text-[#6d7585]">Te han invitado a Fanlink. Elige tu contraseña para entrar con {preview.email}.</p>
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Contraseña</span>
              <input
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                minLength={MIN_LENGTH}
                aria-label="Contraseña"
                className="w-full rounded-xl border border-[#e6e8ee] px-3 py-2 text-sm"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Repite la contraseña</span>
              <input
                type="password"
                autoComplete="new-password"
                value={repeat}
                onChange={(event) => setRepeat(event.target.value)}
                required
                aria-label="Repite la contraseña"
                className="w-full rounded-xl border border-[#e6e8ee] px-3 py-2 text-sm"
              />
            </label>
            {error && <p role="alert" className="text-sm text-[#c0392b]">{error}</p>}
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-xl bg-[#3b6cff] px-4 py-2.5 text-sm font-medium text-white disabled:opacity-60"
            >
              {busy ? "Entrando…" : "Aceptar invitación y entrar"}
            </button>
          </form>
        )}
        {(preview.state === "invalid" || preview.state === "expired" || preview.state === "used" || preview.state === "revoked") && (
          <div className="mt-4 space-y-3">
            <p className="font-display text-xl font-semibold">Invitación no disponible</p>
            <p role="alert" className="text-sm text-[#6d7585]">{preview.message}</p>
            <Link to="/login" className="inline-block text-sm text-[#3b6cff]">Ir a entrar</Link>
          </div>
        )}
      </div>
    </main>
  );
}
