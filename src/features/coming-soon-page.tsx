export function ComingSoonPage({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="grid place-items-center px-6 py-16 text-center">
      <div className="max-w-md">
        <h1 className="font-display text-2xl font-semibold">{title}</h1>
        <p className="mt-2 text-sm font-medium text-primary">Próximamente</p>
        {hint ? <p className="mt-2 text-sm text-muted">{hint}</p> : null}
        <p className="mt-3 text-sm text-muted">Esta sección ya está en el menú, pero la pantalla todavía no está lista.</p>
      </div>
    </div>
  );
}
