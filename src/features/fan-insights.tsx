import { useState, type ReactNode } from "react";
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
  subscribedAt?: string | null;
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
    subscribedAt: props.subscribedAt,
    notes: props.notes,
    transactions: props.transactions,
    ppvPrices: props.ppvPrices,
  });
  return (
    <aside className="flex h-full min-h-0 flex-col bg-[#f7f8fb]">
      <div className="border-b border-[#e6e8ee] bg-white px-4 py-3">
        <p className="text-sm font-semibold">Ficha del fan</p>
        <p className="truncate text-xs text-[#6d7585]">{props.name ?? "Fan"}{props.handle ? ` · @${props.handle.replace(/^@/, "")}` : ""}</p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {tab === "Notas" ? (
          <label className="flex flex-col gap-2 text-xs text-[#6d7585]">
            Notas
            <textarea
              value={props.notes}
              readOnly={!props.notesEditable}
              onChange={(event) => props.onNotes(event.target.value)}
              placeholder="Sin datos"
              className="min-h-40 rounded-xl border border-[#e6e8ee] bg-white p-3 text-sm text-[#1c2333]"
            />
          </label>
        ) : tab === "Ventas" ? (
          <Card title="Ventas">
            <Pair label="Último gasto" value={`${model.lastAgo} · ${model.last}`} />
            <Pair label="PPV total" value={model.ppvTotal} />
            <Pair label="PPV medio" value={model.ppvAvg} />
            <Pair label="Propinas" value={model.tipTotal} />
            <Pair label="Propina media" value={model.tipAvg} />
            <Pair label="Gasto máximo" value={model.max} />
          </Card>
        ) : (
          <div className="space-y-3">
            <Card title="Comportamiento de gasto">
              <div className="grid grid-cols-2 gap-3">
                <Pair label="Gasto total" value={model.total} />
                <Pair label="Último gasto" value={model.lastAgo} />
              </div>
              <Pair label="Tipo del último" value={model.last} />
              <Pair label="PPV total" value={model.ppvTotal} />
              <Pair label="PPV medio" value={model.ppvAvg} />
              <Pair label="Propinas" value={model.tipTotal} />
              <Pair label="Propina media" value={model.tipAvg} />
              <Pair label="Gasto máximo" value={model.max} />
            </Card>
            <Card title="Métricas">
              <Pair label="Poder de gasto" value={model.power} />
              <Pair label="Riesgo de contracargo" value={model.chargeback} />
            </Card>
            <Card title="Suscripción">
              <Pair label="Estado" value={model.status} />
              <Pair label="Caducidad" value={model.expires} />
              <Pair label="Precio al mes" value={model.price} />
              <Pair label="Duración" value={model.duration} />
              <Pair label="Auto-renovación" value={model.renew} />
            </Card>
          </div>
        )}
      </div>
      <div className="grid grid-cols-3 border-t border-[#e6e8ee] bg-white">
        {TABS.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setTab(item)}
            className={`py-3 text-xs ${tab === item ? "font-semibold text-[#2456c7]" : "text-[#6d7585]"}`}
          >
            {item}
          </button>
        ))}
      </div>
    </aside>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details open className="rounded-xl border border-[#e6e8ee] bg-white">
      <summary className="cursor-pointer px-3 py-2 text-sm font-medium">{title}</summary>
      <div className="space-y-2 px-3 pb-3">{children}</div>
    </details>
  );
}

function Pair({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 text-sm">
      <span className="text-[#6d7585]">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}
