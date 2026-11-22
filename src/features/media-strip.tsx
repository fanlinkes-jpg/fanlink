import { useRef, useState, type ReactNode } from "react";

/** Varios medios en el hueco de uno. Flechas, swipe y contador 1/N. */
export function MediaStrip({ children }: { children: ReactNode[] }) {
  const [index, setIndex] = useState(0);
  const start = useRef<number | null>(null);
  const count = children.length;
  const current = Math.min(index, Math.max(0, count - 1));
  const go = (next: number) => setIndex(Math.min(count - 1, Math.max(0, next)));
  return (
    <div
      className="relative mb-1 h-40 w-full max-w-xs"
      role="region"
      aria-label="Medios del mensaje"
      onPointerDown={(event) => {
        start.current = event.clientX;
      }}
      onPointerUp={(event) => {
        if (start.current == null) return;
        const delta = event.clientX - start.current;
        start.current = null;
        if (delta > 36) go(current - 1);
        if (delta < -36) go(current + 1);
      }}
    >
      <div className="h-full overflow-hidden">{children[current]}</div>
      {current > 0 ? (
        <button type="button" aria-label="Medio anterior" className="absolute top-1/2 left-1 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full bg-white/90 text-sm" onClick={() => go(current - 1)}>‹</button>
      ) : null}
      {current < count - 1 ? (
        <button type="button" aria-label="Medio siguiente" className="absolute top-1/2 right-1 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full bg-white/90 text-sm" onClick={() => go(current + 1)}>›</button>
      ) : null}
      <span className="absolute bottom-1 left-1/2 -translate-x-1/2 rounded bg-black/60 px-1.5 text-[10px] text-white">{current + 1}/{count}</span>
    </div>
  );
}
