import { useEffect, useId, useState } from "react";
import { cn } from "@/lib/cn";

const MARK_PATH = "M93 45C93 53.18 89.07 60.44 83 65V75.5Q83 76.38 82.6 76.63Q82.1 76.95 80.95 76.26L70.39 69.89C69.6 69.96 68.8 70 68 70C61.76 70 56.05 67.71 51.67 63.93C54.37 61.12 56.48 57.74 57.790 53.98C60.28 56.81 63.93 58.6 68 58.6C75.51 58.6 81.6 52.51 81.6 45C81.6 37.49 75.51 31.4 68 31.4C62.89 31.4 58.44 34.22 56.12 38.38C56.69 40.49 57 42.71 57 45C57 47.29 56.69 49.51 56.12 51.62C54.99 55.71 52.86 59.38 50 62.35C45.45 67.07 39.07 70 32 70C31.2 70 30.4 69.96 29.61 69.89L19.05 76.26Q17.9 76.95 17.4 76.63Q17 76.38 17 75.5V65C10.93 60.44 7 53.18 7 45C7 31.19 18.19 20 32 20C38.24 20 43.95 22.29 48.33 26.07C45.63 28.88 43.52 32.26 42.21 36.02C39.72 33.19 36.07 31.4 32 31.4C24.49 31.4 18.4 37.49 18.4 45C18.4 52.51 24.49 58.6 32 58.6C37.11 58.6 41.56 55.78 43.88 51.62C43.31 49.51 43 47.29 43 45C43 42.71 43.31 40.49 43.88 38.38C45.01 34.29 47.14 30.62 50 27.65C50.11 27.54 50.21 27.43 50.32 27.32C54.85 22.8 61.1 20 68 20C81.81 20 93 31.19 93 45Z";

export type LogoScheme = "light" | "dark";

/** Claro u oscuro según el tema del sistema. En el servidor se queda en claro. */
function useLogoScheme(): LogoScheme {
  const [scheme, setScheme] = useState<LogoScheme>("light");
  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => setScheme(query.matches ? "dark" : "light");
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);
  return scheme;
}

export function FanlinkMark({
  scheme,
  className,
  title,
}: {
  scheme: LogoScheme;
  className?: string;
  title?: string;
}) {
  const raw = useId().replace(/:/g, "");
  const id = `fanlink-mark-${raw}`;
  const from = scheme === "dark" ? "#9580ff" : "#7b5cff";
  const to = scheme === "dark" ? "#5f87ff" : "#3b6cff";
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 100 100"
      className={className}
      role={title ? "img" : "presentation"}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      <defs>
        <linearGradient id={id} gradientUnits="userSpaceOnUse" x1="7" y1="20" x2="93" y2="78">
          <stop offset="0" stopColor={from} />
          <stop offset="1" stopColor={to} />
        </linearGradient>
      </defs>
      <path d={MARK_PATH} fill={`url(#${id})`} />
    </svg>
  );
}

/** Isotipo, o isotipo más la palabra Fanlink en la fuente de la app. */
export function FanlinkLogo({
  wordmark = false,
  className,
  markClassName,
  title = "Fanlink",
}: {
  wordmark?: boolean;
  className?: string;
  markClassName?: string;
  title?: string;
}) {
  const scheme = useLogoScheme();
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <FanlinkMark scheme={scheme} title={wordmark ? undefined : title} className={markClassName ?? "h-8 w-8 shrink-0"} />
      {wordmark ? <span className="font-display font-semibold tracking-tight">Fanlink</span> : null}
    </span>
  );
}
