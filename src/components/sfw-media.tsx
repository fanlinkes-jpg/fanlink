import { useState, type ReactNode } from "react";
import { useSfw } from "@/lib/ui-prefs";

/** Envuelve una miniatura. Con SFW se difumina; el ratón o un clic la enseña. */
export function SfwMedia({ children, className = "" }: { children: ReactNode; className?: string }) {
  const enabled = useSfw();
  const [revealed, setRevealed] = useState(false);
  return (
    <span
      className={`sfw-media ${enabled && revealed ? "sfw-revealed" : ""} ${className}`.trim()}
      onClick={() => {
        if (enabled) setRevealed((value) => !value);
      }}
    >
      {children}
    </span>
  );
}
