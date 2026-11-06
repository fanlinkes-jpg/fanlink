import { useState } from "react";
import { fanInsightModel } from "@/lib/fan-insights";

export type FanInsightProps = {
  name: string | null;
  handle: string | null;
  spentCents: number | null;
  tipsCents: number | null;
  status: "active" | "expired" | null;
  expiresAt: string | null;
  renewAuto: boolean | null;
  subPriceCents: number | null;
  notes: string;
  notesEditable: boolean;
  onNotes: (value: string) => void;
  transactions: Array<{ occurredAt: string; grossCents: number; kind: string }>;
  ppvPrices: number[];
};

const TABS = ["Datos", "Ventas", "Notas"] as const;

export function FanInsights(props: FanInsightProps) {
  const [tab, setTab] = useState<(typeof TABS)[number]>("Datos");
  const model = fanInsightModel({
    spentCents: props.spentCents,
    tipsCents: props.tipsCents,
    status: props.status,
    expiresAt: props.expiresAt,
    renewAuto: props.renewAuto,
    subPriceCents: props.subPriceCents,
    notes: props.notes,
    transactions: props.transactions,
    ppvPrices: props.ppvPrices,
  });
  const facts = tab === "Ventas"
    ? [
        ["Último gasto", model.last],
        ["PPV total", model.ppvTotal],
        ["PPV medio", model.ppvAvg],
        ["Propinas", model.tipTotal],
        ["Propina media", model.tipAvg],
        ["Gasto máximo", model.max],
      ]
    : [
        ["Gasto total", model.total],
        ["Suscripción", model.status],
        ["Caduca", model.expires],
        ["Precio al mes", model.price],
        ["Auto-renovación", model.renew],
      ];
  return (
    <aside className="flex h-full min-h-0 flex-col bg-white">
      <div className="border-b border-[#e6e8ee] px-4 py-3">
        <p className="font-medium">{props.name ?? "Fan"}</p>
        <p className="text-xs text-[#6d7585]">{props.handle ? `@${props.handle.replace(/^@/, "")}` : "Sin datos"}</p>
      </div>
      <div className="flex gap-1 border-b border-[#e6e8ee] p-2">
        {TABS.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setTab(item)}
            className={`rounded-md px-2 py-1 text-xs ${tab === item ? "bg-[#e7f0ff] text-[#2456c7]" : "text-[#6d7585]"}`}
          >
            {item}
          </button>
        ))}
      </div>
      {tab === "Notas" ? (
        <label className="flex min-h-0 flex-1 flex-col gap-2 p-4 text-xs text-[#6d7585]">
          Notas
          <textarea
            value={props.notes}
            readOnly={!props.notesEditable}
            onChange={(event) => props.onNotes(event.target.value)}
            placeholder="Sin datos"
            className="min-h-32 flex-1 rounded-lg border border-[#e6e8ee] p-2 text-sm text-[#1c2333]"
          />
        </label>
      ) : (
        <dl className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 text-sm">
          {facts.map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs text-[#6d7585]">{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      )}
    </aside>
  );
}
