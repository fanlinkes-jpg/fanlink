import type { ReactNode } from "react";

/** Tarjeta de tabla del área de Personal: mismo título, ancho, margen y tabla en Empleados, Turnos y Métricas. */
export function StaffCard({
  title,
  right,
  filters,
  children,
  testId,
}: {
  title: string;
  right?: ReactNode;
  filters?: ReactNode;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <section className="space-y-3" data-testid={testId}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-base font-semibold tracking-wide">{title}</h2>
        {right && <div className="flex flex-wrap items-center gap-2">{right}</div>}
      </div>
      {filters}
      <div className="overflow-x-auto rounded-lg border border-line">{children}</div>
    </section>
  );
}

export const TABLE_CLASS = "w-full min-w-[820px] text-left text-sm";
export const THEAD_CLASS = "bg-surface text-xs text-muted";
export const TH_CLASS = "px-3 py-2 font-medium";
export const TR_CLASS = "border-t border-line align-middle";
export const TD_CLASS = "px-3 py-3";
