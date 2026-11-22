export function ComingSoonPage({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="grid place-items-center px-6 py-16 text-center">
      <div className="max-w-md">
        <h1 className="font-display text-2xl font-semibold">{title}</h1>
        {hint ? <p className="mt-2 text-sm text-muted">{hint}</p> : null}
      </div>
    </div>
  );
}
