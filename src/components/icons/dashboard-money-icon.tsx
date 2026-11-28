import type { SVGProps } from "react";

/** Gráfica con el símbolo del dinero para Dashboard. Misma rejilla 24, trazo 2 y esquinas redondas que los iconos de lucide. */
export function DashboardMoneyIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M3 3v16a2 2 0 0 0 2 2h16" />
      <path d="M8 17v-4" />
      <path d="M12.5 17v-7" />
      <path d="M20 7c0-1.2-1.1-2-2.5-2S15 5.8 15 7s1.1 1.6 2.5 2S20 10.2 20 11.4s-1.1 2-2.5 2S15 12.6 15 11.4" />
      <path d="M17.5 3.5V15" />
    </svg>
  );
}
